import { getG2bRepository } from "@/server/g2b/repository";
import type { NoticeKey } from "@/entities/notice/model/types";
import {
  groupOpeningResultQueries,
  openingResultQueries,
  type OpeningResultQuery,
} from "@/entities/opening-result/model/opening-result";
import { collectOpeningResult } from "@/features/collect-g2b/server";
import { maintenanceResponse } from "@/shared/api/g2b/g2b-maintenance";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";

/**
 * 현재 공고에서 생성한 개찰결과 조회 조건에 기존 저장 자료의 누락된 분류를 보충한다.
 *
 * 현재 공고의 조회 조건을 우선하고, 공고에 없는 저장된 분류만 보충한다.
 * 개찰차수별로 분류번호의 중복을 방지하며 기존 조회 조건을 덮어쓰지 않는다.
 *
 * @param groups 개찰차수별 현재 조회 조건. 누락된 분류를 이 Map에 직접 추가한다.
 * @param saved 이전에 저장된 개찰결과 자료.
 */
function mergeSavedQueries(
  groups: Map<string, OpeningResultQuery[]>,
  saved: ReturnType<
    ReturnType<typeof getG2bRepository>["listOpeningResults"]
  >,
) {
  for (const result of saved) {
    const queries = groups.get(result.openingRevision) ?? [];
    const known = new Set(queries.map((query) => query.classification));
    for (const { query } of result.results) {
      if (known.has(query.classification)) continue;
      // 과거 유찰 저장 자료는 status/endpoint 없이도 재수집할 수 있다.
      queries.push(query);
      known.add(query.classification);
    }
    if (queries.length) groups.set(result.openingRevision, queries);
  }
}

/**
 * 지정한 공고의 개찰결과 상세를 나라장터에서 다시 수집한다.
 *
 * 현재 공고에서 생성한 조회 조건과 기존 저장 자료의 조회 조건을 병합한 뒤,
 * 개찰차수별 수집을 병렬 실행한다.
 *
 * 개별 차수의 수집 실패가 다른 차수의 실행을 중단시키지 않도록
 * Promise.allSettled를 사용하며, 실패한 차수와 성공한 차수를 구분하여 반환한다.
 *
 * @param _request HTTP 요청 객체. 현재 처리에서는 요청 본문을 사용하지 않는다.
 * @param params 공고번호와 공고차수가 포함된 비동기 경로 매개변수.
 * @returns 성공 시 공고 식별자를 반환한다. 입력 오류는 400, 조회 조건이 없으면 404를 반환한다.
 * 점검이 확인되면 503, 그 외 수집 실패는 502를 반환하며 두 응답 모두 성공·실패 차수를 포함한다.
 * @throws 조회 조건을 구성하는 데 필요한 저장 자료를 읽지 못한 경우.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<NoticeKey> },
) {
  const key = await params;

  // 잘못된 공고 식별자로 조회하거나 수집 작업을 시작하지 않도록 사전에 차단한다.
  if (g2bNumber(key.number) !== key.number || !/^\d{3}$/.test(key.revision)) {
    return Response.json(
      { error: "공고번호와 공고차수를 확인하세요." },
      { status: 400 },
    );
  }

  const repository = getG2bRepository();
  const notice = await repository.find(key);
  const groups = groupOpeningResultQueries(
    notice ? openingResultQueries(notice.payload) : [],
  );

  // 현재 공고에 존재하지 않는 분류라도 이전에 저장된 조회 조건이 있으면 재수집 대상에 포함한다.
  mergeSavedQueries(groups, repository.listOpeningResults(key));

  // 현재 공고와 저장 자료 모두에서 조회 조건을 찾지 못하면 수집을 실행하지 않는다.
  if (!groups.size) {
    return Response.json(
      { error: "조회할 개찰결과 상세를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  // 개찰차수별 수집 결과를 모두 확보하여 일부 실패가 발생해도 나머지 차수의 결과를 확인한다.
  const settled = await Promise.allSettled(
    [...groups].map(([openingRevision, queries]) =>
      collectOpeningResult({ ...key, openingRevision }, queries, true),
    ),
  );

  // 실패한 개찰차수를 응답에 포함해 전체 실패와 부분 실패를 구분할 수 있도록 한다.
  const failedRevisions = [...groups.keys()].filter(
    (_, index) => settled[index].status === "rejected",
  );
  const succeededRevisions = [...groups.keys()].filter(
    (_, index) => settled[index].status === "fulfilled",
  );
  const errors = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  const maintenance = maintenanceResponse(new AggregateError(errors), {
    failedRevisions,
    succeededRevisions,
  });
  if (maintenance) return maintenance;

  // 실패한 차수와 오류 원인을 서버 로그에 기록하여 수집 실패를 추적할 수 있도록 한다.
  settled.forEach((result, index) => {
    if (result.status !== "rejected") return;

    console.error("[개찰결과 수집 실패]", {
      noticeNumber: key.number,
      noticeRevision: key.revision,
      openingRevision: [...groups.keys()][index],
      error: result.reason,
    });
  });

  if (failedRevisions.length) {
    return Response.json(
      {
        error: "나라장터에서 일부 개찰결과를 수집하지 못했습니다.",
        failedRevisions,
        succeededRevisions,
        // 일반 오류에서는 수집 함수가 성공한 분류를 먼저 저장한다.
        // 따라서 실패한 개찰차수에도 일부 성공 자료가 저장되었을 수 있다.
      },
      { status: 502 },
    );
  }

  return Response.json(key);
}

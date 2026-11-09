import { getNoticeRepository } from "@/entities/notice/server";
import type { NoticeKey } from "@/entities/notice/model/types";
import {
  groupOpeningResultQueries,
  openingResultQueries,
  type OpeningResultQuery,
} from "@/entities/opening-result/model/opening-result";
import { collectOpeningResult } from "@/features/collect-notice/api/g2b";
import { g2bNumber } from "@/shared/model/g2b-number";

/** 현재 공고의 조회 조건을 우선하고, 공고에 없는 저장된 분류만 보충한다. */
function mergeSavedQueries(
  groups: Map<string, OpeningResultQuery[]>,
  saved: ReturnType<
    ReturnType<typeof getNoticeRepository>["listOpeningResults"]
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

export async function POST(
  _request: Request,
  { params }: { params: Promise<NoticeKey> },
) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || !/^\d{3}$/.test(key.revision)) {
    return Response.json(
      { error: "공고번호와 공고차수를 확인하세요." },
      { status: 400 },
    );
  }

  const repository = getNoticeRepository();
  const notice = await repository.find(key);
  const groups = groupOpeningResultQueries(
    notice ? openingResultQueries(notice.payload) : [],
  );
  mergeSavedQueries(groups, repository.listOpeningResults(key));

  if (!groups.size) {
    return Response.json(
      { error: "조회할 개찰결과 상세를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const settled = await Promise.allSettled(
    [...groups].map(([openingRevision, queries]) =>
      collectOpeningResult({ ...key, openingRevision }, queries, true),
    ),
  );
  const failedRevisions = [...groups.keys()].filter(
    (_, index) => settled[index].status === "rejected",
  );

  if (failedRevisions.length) {
    return Response.json(
      {
        error: "나라장터에서 일부 개찰결과를 수집하지 못했습니다.",
        failedRevisions,
        succeededRevisions: [...groups.keys()].filter(
          (_, index) => settled[index].status === "fulfilled",
        ),
        // 수집 함수는 성공한 분류를 먼저 저장하고 실패를 반환한다.
        // 따라서 실패한 개찰차수에도 일부 성공 자료가 저장되었을 수 있다.
      },
      { status: 502 },
    );
  }

  return Response.json(key);
}

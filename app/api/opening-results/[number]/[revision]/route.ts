import { getG2bRepository } from "@/server/g2b/repository";
import type { NoticeKey } from "@/entities/notice/model/types";
import {
  groupOpeningResultQueries,
  openingResultQueries,
  type OpeningResultQuery,
} from "@/entities/opening-result/model/opening-result";
import { acceptNoticeJob, checkNoticeQueueMaintenance } from "@/features/collect-g2b/api/notice-queue-service";
import { collectOpeningGroups, type OpeningCollectionReport } from "@/features/collect-g2b/api/opening-results";
import { parseCollectNoticeInput } from "@/features/collect-g2b/model/input";
import { maintenanceResponse } from "@/shared/api/g2b/g2b-maintenance";

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
  saved: Awaited<ReturnType<
    ReturnType<typeof getG2bRepository>["listOpeningResults"]
  >>,
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

function responseDetails(report: OpeningCollectionReport | undefined, noticeSaved: boolean) {
  return {
    noticeSaved,
    targetRevisions: report?.targetRevisions ?? [],
    succeededRevisions: report?.succeededRevisions ?? [],
    failedRevisions: report?.failures.map(({ revision }) => revision) ?? [],
  };
}

/**
 * 저장된 공고가 있으면 개찰결과를 다시 조회하고, 없으면 공고 수집을 큐에 접수한다.
 * @param request 선택적으로 낙찰방법 코드를 JSON 본문에 전달한다. 기존 상세 버튼은 본문을 생략한다.
 * @param params 차세대 BK 공고번호와 세 자리 공고차수.
 * @returns 직접 조회 성공 시 공고 식별자와 차수별 결과, 공고 수집 접수 시 202와 작업 ID. 입력 오류는 400, 개찰 대상 없음은 404,
 * 수집 실패는 502, 점검은 503으로 응답한다.
 * @throws 저장된 공고나 개찰결과 조회에 실패한 경우.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<NoticeKey> },
) {
  const key = await params;
  if (!key.number.trim()) return Response.json({ error: "번호를 입력해 주세요." }, { status: 400 });
  if (!/^\d{3}$/.test(key.revision)) {
    return Response.json({ error: "공고차수를 확인하세요." }, { status: 400 });
  }

  const body = await request.text();
  let input: ReturnType<typeof parseCollectNoticeInput> = null;
  try {
    const options = body.trim() ? JSON.parse(body) : {};
    if (options && typeof options === "object" && !Array.isArray(options)) {
      input = parseCollectNoticeInput({
        ...key,
        methodCode: Object.hasOwn(options, "methodCode") ? options.methodCode : "",
      });
    }
  } catch {
    // 잘못된 본문은 외부 요청을 보내기 전에 400으로 처리한다.
  }
  if (!input) {
    return Response.json({ error: "낙찰방법 코드를 확인하세요." }, { status: 400 });
  }

  const repository = getG2bRepository();
  const notice = await repository.find(key);
  let report: OpeningCollectionReport;
  if (notice) {
    await checkNoticeQueueMaintenance();
    const groups = groupOpeningResultQueries(openingResultQueries(notice.payload));
    mergeSavedQueries(groups, await repository.listOpeningResults(key));
    report = await collectOpeningGroups(groups, true);
  } else {
    return acceptNoticeJob({ ...input, opening: true });
  }

  const details = responseDetails(report, true);
  if (!report.targetRevisions.length) {
    return Response.json({
      ...details,
      error: "조회할 개찰결과 상세를 찾을 수 없습니다.",
    }, { status: 404 });
  }

  const maintenance = maintenanceResponse(new AggregateError(report.failures.map(({ error }) => error)), details);
  if (maintenance) return maintenance;
  if (report.failures.length) {
    for (const { revision, error } of report.failures) {
      console.error("[개찰결과 수집 실패]", { ...key, openingRevision: revision, error });
    }
    return Response.json({
      ...details,
      error: "나라장터에서 개찰결과를 모두 수집하지 못했습니다.",
    }, { status: 502 });
  }
  return Response.json({ ...key, ...details });
}

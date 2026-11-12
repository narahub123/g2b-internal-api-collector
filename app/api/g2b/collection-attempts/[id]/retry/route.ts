import { getG2bRepository } from "@/server/g2b/repository";
import { isCollectionAttemptActive } from "@/features/collect-g2b/api/collection-attempt";
import { collectionNumberError } from "@/features/collect-g2b/model/number";
import {
  collectNoticeWithRelated,
  collectContract,
  collectContractRequest,
  collectOpeningResult,
  collectOrderPlan,
  collectPriorSpec,
} from "@/features/collect-g2b/server";
import { maintenanceResponse } from "@/shared/api/g2b/g2b-maintenance";

/**
 * 대상의 최신 수집 이력에 보존된 입력으로 같은 업무의 수집을 다시 실행한다.
 * 입찰공고 재시도는 요청 공고를 저장한 뒤 연결된 공고도 탐색한다.
 * @returns 성공 시 빈 204 응답. 번호 형식 오류는 400, 없는 이력은 404, 진행 중이거나 바뀐 이력은 409,
 * 나라장터 점검은 503, 기타 수집 오류는 502를 반환한다.
 * @throws 재시도 대상 이력을 읽지 못한 경우.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const attemptId = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(attemptId)) {
    return Response.json({ error: "수집 이력을 찾을 수 없습니다." }, { status: 404 });
  }

  const target = getG2bRepository().collectionAttempts.retryTarget(attemptId);
  if (target === "missing") {
    return Response.json({ error: "수집 이력을 찾을 수 없습니다." }, { status: 404 });
  }
  if (target === "conflict" || isCollectionAttemptActive(attemptId)) {
    return Response.json({ error: "수집 상태가 바뀌었거나 수집이 진행 중입니다." }, { status: 409 });
  }

  const numberError = collectionNumberError(target.section, target.number);
  if (numberError) return Response.json({ error: numberError }, { status: 400 });

  try {
    switch (target.section) {
      case "order-plans":
        await collectOrderPlan(target.number, true);
        break;
      case "prior-specs":
        await collectPriorSpec(target.number, true);
        break;
      case "contract-requests":
        await collectContractRequest({ number: target.number, revision: target.revision }, true);
        break;
      case "contracts":
        await collectContract({ number: target.number, revision: target.revision }, true);
        break;
      case "notices":
        await collectNoticeWithRelated({ number: target.number, revision: target.revision, methodCode: target.methodCode });
        break;
      case "opening-results":
        await collectOpeningResult({
          number: target.number, revision: target.revision, openingRevision: target.openingRevision,
        }, target.queries, true);
        break;
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return maintenanceResponse(error) ??
      Response.json({ error: "나라장터 데이터를 다시 수집하지 못했습니다." }, { status: 502 });
  }
}

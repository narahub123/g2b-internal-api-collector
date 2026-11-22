import { withBusinessAccess } from "@/server/auth/business-access";
import { getG2bRepository } from "@/server/g2b/repository";
import { isCollectionAttemptActive } from "@/features/collect-g2b/api/collection-attempt";
import {
  collectContract,
  collectContractRequest,
  collectOpeningResult,
  collectPriorSpec,
} from "@/features/collect-g2b/server";
import { acceptNoticeJob, checkNoticeQueueMaintenance, collectPlanAndEnqueueNotices, QueueRegistrationError } from "@/features/collect-g2b/api/notice-queue-service";
import { maintenanceResponse } from "@/shared/api/g2b/g2b-maintenance";

/**
 * 대상의 최신 수집 이력에 보존된 입력으로 같은 업무의 수집을 다시 실행한다.
 * 입찰공고는 큐에 접수하고 발주계획은 저장한 뒤 관련 공고를 등록한다.
 * @param request 목록 화면은 이력 삭제 후 재사용된 ID를 구분할 시작 시각을 보낸다.
 * @returns 공고 접수 시 작업 ID와 202, 발주계획 미존재 또는 사전규격 조회 불가 시 조회 상태와 200, 다른 업무 성공 시 빈 204 응답. 번호 형식 오류는 400, 없는 이력은 404, 진행 중이거나 바뀐 이력은 409,
 * 나라장터 점검은 503, 기타 수집 오류는 502를 반환한다.
 * @throws 재시도 대상 이력을 읽지 못한 경우.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const attemptId = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(attemptId)) {
    return Response.json({ error: "수집 이력을 찾을 수 없습니다." }, { status: 404 });
  }

  const startedAt = new URL(request.url).searchParams.get("startedAt") ?? undefined;
  const target = await getG2bRepository().collectionAttempts.retryTarget(attemptId, startedAt);
  if (target === "missing") {
    return Response.json({ error: "수집 이력을 찾을 수 없습니다." }, { status: 404 });
  }
  if (target === "conflict" || isCollectionAttemptActive(attemptId)) {
    return Response.json({ error: "수집 상태가 바뀌었거나 수집이 진행 중입니다." }, { status: 409 });
  }


  if (target.section !== "notices" && target.section !== "order-plans") await checkNoticeQueueMaintenance();
  try {
    switch (target.section) {
      case "order-plans": {
        const result = await collectPlanAndEnqueueNotices(target.number);
        if (result.status) return Response.json(result);
        break;
      }
      case "prior-specs": {
        const result = await collectPriorSpec(target.number, true);
        if (result) return Response.json(result);
        break;
      }
      case "contract-requests":
        await collectContractRequest({ number: target.number, revision: target.revision }, true);
        break;
      case "contracts":
        await collectContract({ number: target.number, revision: target.revision }, true);
        break;
      case "notices":
        return acceptNoticeJob({ number: target.number, revision: target.revision, methodCode: target.methodCode }, attemptId);
      case "opening-results":
        await collectOpeningResult({
          number: target.number, revision: target.revision, openingRevision: target.openingRevision,
        }, target.queries, true);
        break;
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof QueueRegistrationError) return Response.json({ error: error.message }, { status: 503 });
    return maintenanceResponse(error) ??
      Response.json({ error: "나라장터 데이터를 다시 수집하지 못했습니다." }, { status: 502 });
  }
}

// 최신 관리자 권한을 확인한 뒤 운영 기능을 실행한다.
export const POST = withBusinessAccess("ADMIN", handlePOST);

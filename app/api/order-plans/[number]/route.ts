import { withBusinessAccess } from "@/server/auth/business-access";
import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';
import { collectPlanAndEnqueueNotices, QueueRegistrationError } from '@/features/collect-g2b/api/notice-queue-service';

/**
 * 차세대 DD 발주계획번호로 상세와 첨부 목록을 다시 조회해 수집이 완료되면 기존 자료를 교체한다.
 * 저장된 계획의 원본 공고 목록을 영속 큐에 등록한다.
 * @returns 성공 시 발주계획번호, 미존재 시 요청 번호와 조회 상태를 반환한다. 입력 오류는 400, 점검 보류나 큐 등록 실패는 503, 그 외 수집 오류는 502다.
 */
async function handlePOST(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!number.trim()) return Response.json({ error: "번호를 입력해 주세요." }, { status: 400 });
  try {
    return Response.json(await collectPlanAndEnqueueNotices(number));
  } catch (error) {
    if (error instanceof QueueRegistrationError) return Response.json({ error: error.message }, { status: 503 });
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 발주계획을 수집하지 못했습니다.' }, { status: 502 });
  }
}

// 최신 관리자 권한을 확인한 뒤 운영 기능을 실행한다.
export const POST = withBusinessAccess("ADMIN", handlePOST);

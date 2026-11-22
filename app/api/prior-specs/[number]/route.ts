import { withBusinessAccess } from "@/server/auth/business-access";
import { checkNoticeQueueMaintenance } from '@/features/collect-g2b/api/notice-queue-service';
import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';
import { collectPriorSpec } from '@/features/collect-g2b/server';

/**
 * 차세대 BD 사전규격등록번호로 상세와 공개 첨부 목록을 다시 조회해 수집이 완료되면 기존 자료를 교체한다.
 * @returns 성공 시 등록번호, 상세 조회 불가 시 등록번호와 상태를 200으로 반환한다. 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
async function handlePOST(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!number.trim()) return Response.json({ error: "번호를 입력해 주세요." }, { status: 400 });
  await checkNoticeQueueMaintenance();
  try {
    const result = await collectPriorSpec(number, true);
    return Response.json(result ?? { number });
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 사전규격을 수집하지 못했습니다.' }, { status: 502 });
  }
}

// 최신 관리자 권한을 확인한 뒤 운영 기능을 실행한다.
export const POST = withBusinessAccess("ADMIN", handlePOST);

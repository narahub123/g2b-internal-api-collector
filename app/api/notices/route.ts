import { getG2bRepository } from '@/server/g2b/repository';
import { collectAndSaveNotice, parseCollectNoticeInput } from '@/features/collect-g2b/server';
import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';

/**
 * 목록 화면에 표시할 공고 요약을 SQLite에서 읽어 반환한다.
 * @throws 저장소를 열거나 목록을 조회하지 못한 경우.
 */
export async function GET() {
  return Response.json(await getG2bRepository().list());
}

/**
 * 공고 상세와 관련 자료를 수집해 공고 행을 저장한다. 일반 부가 조회 실패 시 재사용할 수 있는 기존 자료를 보완한다.
 * @param request JSON 본문에 공고번호, 세 자리 차수, 낙찰방법 코드를 전달한다.
 * @returns 저장 성공 시 공고 식별자, 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
export async function POST(request: Request) {
  const input = parseCollectNoticeInput(await request.json().catch(() => null));
  if (!input) {
    return Response.json({ error: '공고번호, 세 자리 차수, 낙찰방법 코드를 확인하세요.' }, { status: 400 });
  }

  const { number, revision, methodCode } = input;
  try {
    await collectAndSaveNotice({ number, revision, methodCode });
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 공고 상세를 가져오지 못했습니다.' }, { status: 502 });
  }
  return Response.json({ number, revision });
}

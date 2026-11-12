import { getG2bRepository } from '@/server/g2b/repository';
import { collectNoticeWithRelated, parseCollectNoticeInput } from '@/features/collect-g2b/server';
import { collectionNumberError } from '@/features/collect-g2b/model/number';
import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';

/**
 * 목록 화면에 표시할 공고 요약을 SQLite에서 읽어 반환한다.
 * @throws 저장소를 열거나 목록을 조회하지 못한 경우.
 */
export async function GET() {
  return Response.json(await getG2bRepository().list());
}

/**
 * 요청 공고를 저장한 뒤 연결된 미수집 또는 손상 공고를 탐색해 수집한다.
 * @param request JSON 본문에 차세대 BK 공고번호, 세 자리 차수, 낙찰방법 코드를 전달한다.
 * @returns 저장 성공 시 공고 식별자, 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const numberError = collectionNumberError('notices', body?.number);
  if (numberError) return Response.json({ error: numberError }, { status: 400 });
  const input = parseCollectNoticeInput(body);
  if (!input) {
    return Response.json({ error: '공고번호, 세 자리 차수, 낙찰방법 코드를 확인하세요.' }, { status: 400 });
  }

  const { number, revision } = input;
  try {
    await collectNoticeWithRelated(input);
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 공고 상세를 가져오지 못했습니다.' }, { status: 502 });
  }
  return Response.json({ number, revision });
}

import { getG2bRepository } from '@/server/g2b/repository';
import { parseCollectNoticeInput } from '@/features/collect-g2b/server';
import { collectionNumberError } from '@/features/collect-g2b/model/number';
import { acceptNoticeJob } from '@/features/collect-g2b/api/notice-queue-service';

/**
 * 목록 화면에 표시할 공고 요약을 SQLite에서 읽어 반환한다.
 * @throws 저장소를 열거나 목록을 조회하지 못한 경우.
 */
export async function GET() {
  return Response.json(await getG2bRepository().list());
}

/**
 * 요청 공고를 영속 접수하여 워커가 단건 저장과 연관 탐색을 처리하게 한다.
 * @param request JSON 본문에 차세대 BK 공고번호, 세 자리 차수, 낙찰방법 코드를 전달한다.
 * @returns 접수 시 작업 ID와 202, 입력 오류는 400, 큐 저장 실패는 503.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const numberError = collectionNumberError('notices', body?.number);
  if (numberError) return Response.json({ error: numberError }, { status: 400 });
  const input = parseCollectNoticeInput(body);
  if (!input) {
    return Response.json({ error: '공고번호, 세 자리 차수, 낙찰방법 코드를 확인하세요.' }, { status: 400 });
  }

  return acceptNoticeJob(input);
}

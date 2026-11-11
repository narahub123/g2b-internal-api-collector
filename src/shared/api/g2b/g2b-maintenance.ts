import { decodeHTML } from 'entities';
import sanitizeHtml from 'sanitize-html';

/** 확인된 점검을 일반 응답 오류와 구분하고 수집·다운로드 라우트에서 같은 안내를 표시하는 데 사용한다. */
export class G2bMaintenanceError extends Error {
  constructor() {
    super('나라장터 시스템 점검으로 요청을 보류했습니다. 점검 종료 후 다시 시도해 주세요.');
    this.name = 'G2bMaintenanceError';
  }
}

/**
 * HTTP 200으로 반환될 수 있는 점검 화면을 JSON 파싱 전에 검사한다.
 * HTML의 제목과 표시 텍스트에서 현재 서비스 중단 근거가 모두 확인되어야 한다.
 * @param body 파싱하기 전 나라장터 응답 본문.
 * @throws 명시적인 점검 화면이면 G2bMaintenanceError.
 */
export function assertNotMaintenance(body: string): void {
  if (!body.trimStart().startsWith('<')) return;

  // HTML 파서로 주석과 스크립트 등을 제외하고 제목 태그와 표시 텍스트만 남긴다.
  const html = sanitizeHtml(body, {
    allowedTags: ['title', 'h1', 'h2'],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'template', 'noscript'],
  });
  // 파서가 남긴 제목의 공백·문자 참조 차이를 허용하고, 제목 자체는 본문 근거에서 제외한다.
  const titles = /<(title|h1|h2)>([^<]*)<\/\1>/g;
  const normalize = (text: string) => decodeHTML(text).replace(/\s/g, '');
  const hasHeading = Array.from(html.matchAll(titles)).some(
    ([, , title]) => normalize(title) === '시스템점검안내',
  );
  const text = html.replace(/<title>[^<]*<\/title>/g, '').replace(/<\/?h[12]>/g, '');
  if (hasHeading && normalize(text).includes('현재웹서비스가중단되고있음을알려드립니다')) {
    throw new G2bMaintenanceError();
  }
}

/**
 * 나라장터 응답 스트림을 한 번 소비해 점검 여부를 검사한다.
 * @param response 아직 본문을 읽지 않은 나라장터 응답.
 * @returns 호출자가 HTTP 상태 확인과 후속 파싱에 사용할 원문.
 * @throws 명시적인 점검이면 G2bMaintenanceError를 던지며, 본문 읽기 실패는 원래 오류를 전달한다.
 */
export async function readG2bResponse(response: Response): Promise<string> {
  const body = await response.text();
  assertNotMaintenance(body);
  return body;
}

/**
 * 래핑된 오류의 원인과 병렬 수집 오류 목록을 탐색해 점검 신호를 복원한다.
 * 같은 오류를 다시 방문하지 않아 순환 참조에서도 탐색을 끝낸다.
 * @returns 확인된 점검 오류 또는 점검 근거가 없을 때 undefined.
 */
export function findMaintenance(error: unknown): G2bMaintenanceError | undefined {
  const pending = [error];
  const seen = new Set<Error>();
  while (pending.length) {
    const reason = pending.pop();
    if (reason instanceof G2bMaintenanceError) return reason;
    if (!(reason instanceof Error) || seen.has(reason)) continue;
    seen.add(reason);
    pending.push(reason.cause);
    if (reason instanceof AggregateError) pending.push(...reason.errors);
  }
}

/**
 * 병렬 조회 결과에서 점검을 우선 전파해 일반 부분 실패 처리나 저장으로 넘어가지 않게 한다.
 * @param results 완료된 병렬 조회 결과. 거부된 결과의 원인만 검사한다.
 * @throws 거부 원인에 포함된 G2bMaintenanceError.
 */
export function throwIfMaintenance(...results: ReadonlyArray<{ status: string; reason?: unknown }>): void {
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    const maintenance = findMaintenance(result.reason);
    if (maintenance) throw maintenance;
  }
}

/**
 * 확인된 나라장터 점검을 API 호출자에게 공통 안내와 코드로 전달한다.
 * @param details 개찰차수별 처리 결과처럼 응답에 유지할 부가 정보.
 * @returns 점검이면 JSON 503 응답, 그 외에는 호출자가 기존 오류 처리를 이어가도록 undefined를 반환한다.
 */
export function maintenanceResponse(error: unknown, details?: Record<string, unknown>): Response | undefined {
  const maintenance = findMaintenance(error);
  if (maintenance) {
    return Response.json(
      { ...details, error: maintenance.message, code: 'g2b_maintenance' },
      { status: 503 },
    );
  }
}

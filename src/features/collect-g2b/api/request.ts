import { readG2bResponse } from "@/shared/api/g2b/g2b-maintenance";

const origin = "https://www.g2b.go.kr";

// Menu-Info는 나라장터 내부 API에서 요청 화면을 구분한다.
const detailMenu =
  '{"menuNo":"15620","menuCangVal":"FIUA027_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"08542"}';

/** 제안요청 문서의 접근 거부를 일반 요청 실패와 구분하기 위한 오류 유형. */
export class G2bAccessDenied extends Error {}

// 공개 조회와 익명 쿠키가 필요한 조회가 같은 응답 검증 경로를 사용하도록 요청 함수를 주입한다.
export type G2bRequest = (url: URL, init: RequestInit) => Promise<Response>;

/**
 * 나라장터 내부 API에 JSON 요청을 보내고 HTTP 상태 및 업무 오류 코드를 검사한다.
 * 점검 화면은 HTTP 200으로도 반환되므로 본문을 먼저 확인한다.
 * 세션이 필요한 호출은 주입된 request를 사용하며, 메뉴 정보는 조회 화면에 맞게 지정한다.
 *
 * @param path API 경로.
 * @param submissionid 요청을 발생시킨 화면의 submission 식별자.
 * @param input 전송할 JSON 요청 데이터.
 * @param request 세션 요청 함수. 기본값은 fetch.
 * @param menuInfo 화면별 메뉴 식별 정보.
 * @returns 오류 코드 검증을 통과한 API 원본 응답.
 * @throws 점검 응답, HTTP 접근 거부, 통신·본문 읽기·JSON 파싱 실패 또는 API 업무 오류가 발생한 경우.
 */
export async function postG2b(
  path: string,
  submissionid: string,
  input: object,
  request: G2bRequest = fetch,
  menuInfo = detailMenu,
) {
  const response = await request(new URL(path, origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json",
      Origin: origin,
      "Menu-Info": menuInfo,
      submissionid,
    },
    body: JSON.stringify(input),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body = await readG2bResponse(response);
  if (response.status === 403)
    throw new G2bAccessDenied(`나라장터 API 접근이 거부됐습니다: ${path}`);
  if (!response.ok)
    throw new Error(`나라장터 API 요청에 실패했습니다: ${path}`);
  const result = JSON.parse(body);
  if (String(result?.ErrorCode) !== "0")
    throw new Error(`나라장터 API가 오류를 반환했습니다: ${path}`);
  return result;
}

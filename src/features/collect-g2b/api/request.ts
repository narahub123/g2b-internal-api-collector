import { readG2bResponse } from "@/shared/api/g2b/g2b-maintenance";
import { collectionError } from "@/shared/api/g2b/collection-diagnostic";

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
 * 사전규격 상세는 코드 99와 상세 데이터가 함께 반환될 수 있어 등록번호가 있는 응답을 호출자에게 넘긴다.
 * 호출자는 응답 등록번호가 요청 번호와 일치하는지 확인한 뒤 저장한다.
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
  const timeoutMs = 15000;
  const context = { request: { path, submissionId: submissionid, timeoutMs } };
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
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error: unknown) => {
    throw collectionError(error, { ...context, step: "API 요청" });
  });
  const responseInfo = { status: response.status, contentType: response.headers.get("content-type") ?? undefined };
  const body = await readG2bResponse(response).catch((error: unknown) => {
    throw collectionError(error, { ...context, response: responseInfo, step: "API 응답 읽기" });
  });
  let result;
  try {
    result = JSON.parse(body);
  } catch (error) {
    // HTTP 오류 페이지는 상태를 우선 기록하고, 정상 상태에서만 JSON 해석 실패를 기록한다.
    if (response.ok) {
      const position = error instanceof SyntaxError ? /\bposition (\d+)\b/.exec(error.message)?.[1] : undefined;
      throw collectionError(error, {
        ...context, response: responseInfo, step: "JSON 해석",
        details: position === undefined ? undefined : { "오류 위치": Number(position) },
      });
    }
  }
  const errorCode = result?.ErrorCode;
  const errorMessage = result?.ErrorMsg ?? result?.ErrorMessage;
  const responseContext = {
    ...context,
    response: {
      ...responseInfo,
      errorCode: typeof errorCode === "string" || typeof errorCode === "number" ? errorCode : undefined,
      errorMessage: typeof errorMessage === "string" ? errorMessage : undefined,
    },
  };
  if (response.status === 403)
    throw collectionError(new G2bAccessDenied(`나라장터 API 접근이 거부됐습니다: ${path}`), { ...responseContext, step: "HTTP 응답" });
  if (!response.ok)
    throw collectionError(new Error(`나라장터 API 요청에 실패했습니다: ${path}`), { ...responseContext, step: "HTTP 응답" });
  // 코드 99와 상세가 함께 반환된 사례는 사전규격 상세에서 확인됐다.
  const isPriorSpecDetailWithCode99 =
    path === "/pn/pnz/pnza/BfSpec/selectBfSpec.do" &&
    String(errorCode) === "99" &&
    typeof result?.dlBfSpecM?.bfSpecRegNo === "string" &&
    result.dlBfSpecM.bfSpecRegNo.trim() !== "";
  if (String(errorCode) !== "0" && !isPriorSpecDetailWithCode99)
    throw collectionError(new Error(`나라장터 API가 오류를 반환했습니다: ${path}`), {
      ...responseContext,
      step: errorCode === undefined ? "응답 검증" : "나라장터 업무 응답",
      details: errorCode === undefined ? { "응답 필드": "ErrorCode" } : undefined,
    });
  return result;
}

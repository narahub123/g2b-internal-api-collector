import { BUSINESS_AUTH_HEADER, BUSINESS_AUTH_STATUS, BUSINESS_PAGE_HEADER, DOWNLOAD_DESTINATION_HEADER, type BusinessAuthFailure } from "@/shared/model/business-auth";
import { AUTH_RETURN_PATH, PAGE_PATH_HEADER, canAccessPage, parseInternalPage } from "@/shared/config/page-access";
import { headers } from "next/headers";
import type { AuthVerification } from "./session";
import { renewBusinessSession, verifyBusinessUser } from "./business-session";

/** USER는 로그인 필요, ADMIN은 관리자 역할까지 필요한 업무이다. */
type BusinessRole = "USER" | "ADMIN";

/** 상세 내부 오류 대신 페이지와 토스트에 표시할 공통 메시지. */
const failures = {
  unauthenticated: { auth: "unauthenticated", error: "로그인이 필요합니다." },
  forbidden: { auth: "forbidden", error: "이 기능을 실행할 권한이 없습니다." },
  unavailable: { auth: "unavailable", error: "인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." },
} as const satisfies Record<BusinessAuthFailure["auth"], BusinessAuthFailure>;

/**
 * 최신 내부 사용자 상태와 업무 역할을 확인하고 통과 시 기존 검증 결과로 쿠키를 갱신한다.
 * @param role 업무가 요구하는 최소 역할.
 * @param verify 현재 요청의 사용자 상태를 읽는 함수.
 * @param currentPage 권한 부족 뒤 화면 이동 여부를 판단할 내부 경로 또는 경로 조회 함수.
 * @returns 검증 성공 시 null, 실패하면 공통 인증 실패 정보.
 */
export async function checkBusinessAccess(
  role: BusinessRole,
  verify: () => Promise<AuthVerification> = verifyBusinessUser,
  currentPage?: string | null | (() => Promise<string | null>),
): Promise<BusinessAuthFailure | null> {
  try {
    const state = await verify();
    if (state.status === "unauthenticated") return failures.unauthenticated;
    if (state.status === "error") return failures.unavailable;
    if (role === "ADMIN" && state.state.role !== "ADMIN") {
      // 역할 검증은 끝났다. 화면 주소는 이동 안내를 고를 때만 사용한다.
      const page = parseInternalPage(typeof currentPage === "function" ? await currentPage() : currentPage);
      if (!page || canAccessPage(page.pathname, state.state.role)) return failures.forbidden;
      return {
        ...failures.forbidden,
        destination: `${AUTH_RETURN_PATH}?${new URLSearchParams({ from: page.pathname, reason: "business" })}`,
      };
    }
    // 권한이 부족하거나 상태를 확인할 수 없는 요청에서는 쿠키를 갱신하지 않는다.
    await renewBusinessSession(state);
    return null;
  } catch (error) {
    console.error("[업무 인증]", error instanceof Error ? error.name : "UnknownError");
    return failures.unavailable;
  }
}

/**
 * 관리 작업의 Server Action에 최신 역할과 실행 결과를 연결한다.
 * @returns 성공 시 null, 거절이면 공통 상태와 해당하는 경우의 복귀 주소.
 */
export async function checkAdminAction() {
  // Proxy가 현재 요청에서 다시 설정한 페이지 경로를 사용한다.
  return checkBusinessAccess("ADMIN", undefined, async () => (await headers()).get(PAGE_PATH_HEADER));
}

/**
 * Route Handler에 권한 확인을 적용하고 기존 업무 함수 및 응답 형식을 유지한다.
 * @param role 업무를 수행할 최소 역할.
 * @param handler 인증 성공 후 실행할 기존 업무 함수.
 * @param verify 동일 요청의 사용자 상태 확인 함수.
 * @returns 인증 검증을 먼저 수행하는 Route Handler.
 */
export function withBusinessAccess<Args extends unknown[]>(
  role: BusinessRole,
  handler: (...args: Args) => Promise<Response>,
  verify: () => Promise<AuthVerification> = verifyBusinessUser,
) {
  /**
   * 실패 응답을 업무 함수보다 먼저 반환해 저장소와 외부 API 호출을 차단한다.
   * @param args Next.js 요청 및 라우트 매개변수.
   * @returns 업무 응답 또는 인증 실패 상태.
   */
  return async function protectedHandler(...args: Args): Promise<Response> {
    const request = args[0];
    const page = request instanceof Request ? request.headers.get(BUSINESS_PAGE_HEADER) : null;
    const failure = await checkBusinessAccess(role, verify, page);
    if (failure) return Response.json(failure, {
      status: BUSINESS_AUTH_STATUS[failure.auth],
      headers: { [BUSINESS_AUTH_HEADER]: failure.auth, "Cache-Control": "no-store" },
    });
    return handler(...args);
  };
}

/**
 * 사용자 다운로드에 인증을 적용하고 브라우저가 요청한 경우 기존 리다이렉트 주소만 전달한다.
 * @param handler 검증한 다운로드 주소를 302로 제공하는 기존 업무 함수.
 * @returns 일반 호출에는 302를 보존하고 화면 호출에는 인증 오류 처리가 가능한 다운로드 진입점.
 */
export function withDownloadAccess<Context>(handler: (request: Request, context: Context) => Promise<Response>) {
  return withBusinessAccess("USER", async (request: Request, context: Context) => {
    const response = await handler(request, context);
    const location = response.headers.get("location");
    if (request.headers.get(DOWNLOAD_DESTINATION_HEADER) === "1" && response.status === 302 && location) {
      return Response.json({ location }, { headers: { "Cache-Control": "no-store" } });
    }
    return response;
  });
}

import { AUTH_SUCCESS_PATH } from "./auth";
import { isOAuthProvider } from "./oauth-providers";
import { MYPAGE_MENUS, myPageMenuPath } from "./mypage";

/** 인증과 메뉴에서 사용하는 최신 서버 역할. null은 비로그인이다. */
export type PageRole = "USER" | "ADMIN" | null;

/** 공개, 비로그인 전용, 로그인 필수, 관리자 전용 페이지 정책. */
type PageAccess = "public" | "guest" | "member" | "admin";

/** 인증 검증에 장애가 발생했을 때 사용하는 공개 안내 경로. */
export const AUTH_ERROR_PATH = "/auth/error";

/** 현재 권한으로 이전 페이지를 검증할 공개 복귀 경로. */
export const AUTH_RETURN_PATH = "/auth/return";

/** Proxy가 실제 요청 경로로 덮어쓰는 서버 렌더링용 헤더. */
export const PAGE_PATH_HEADER = "x-g2b-page-path";

// 인증 과정에서 비로그인 상태로 표시할 수 있는 정확한 경로만 등록한다.
const guestPages = new Set(["/login", "/signup", "/auth/complete", "/auth/link-account"]);
// 사이트 루트와 실패 처리 경로는 누구나 도달할 수 있어야 한다.
const publicPages = new Set(["/", AUTH_ERROR_PATH, AUTH_RETURN_PATH]);
// 실제 메뉴 경로만 방문 이력과 탐색별 세션 갱신에 사용한다.
const myPageMenuPaths = new Set<string>(MYPAGE_MENUS.map(({ id }) => myPageMenuPath(id)));
// 각 나라장터 상세가 URL에서 사용하는 업무 식별자 수를 정의한다.
const detailSegments = new Map([
  ["order-plans", 1], ["prior-specs", 1], ["contract-requests", 2],
  ["notices", 2], ["opening-results", 2], ["contracts", 2],
]);

/**
 * 동일 경로 비교에서 끝 슬래시 차이를 제거한다.
 * @param path 쿼리가 없는 서비스 경로.
 * @returns 빈 루트를 슬래시로 보존한 정규 경로.
 */
function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/**
 * 경로가 등록한 페이지 또는 해당 페이지의 하위 경로인지 확인한다.
 * @param path 쿼리가 없는 경로.
 * @param root 하위 경로를 포함할 기준 경로.
 * @returns 경계가 일치하거나 슬래시 다음으로 하위 경로가 시작하면 true.
 */
export function isPageBranch(path: string, root: string): boolean {
  const canonical = normalizePath(path);
  const parent = normalizePath(root);
  // 루트는 모든 내부 경로의 상위이고 나머지는 슬래시 경계를 요구한다.
  return parent === "/" ? canonical.startsWith("/") : canonical === parent || canonical.startsWith(`${parent}/`);
}

/**
 * 요청 경로에 적용할 공개·역할 정책을 결정한다.
 * @param path 쿼리가 없는 브라우저 요청 경로.
 * @returns 명시 정책이 없으면 로그인 필수 정책.
 */
export function pageAccessFor(path: string): PageAccess {
  const canonical = normalizePath(path);
  // 등록된 공급자의 정확한 콜백만 공개 경로로 허용한다.
  const callback = /^\/auth\/([^/]+)\/callback$/.exec(canonical);
  if (publicPages.has(canonical) || (callback && isOAuthProvider(callback[1]))) return "public";
  if (guestPages.has(canonical)) return "guest";
  if (isPageBranch(canonical, "/admin")) return "admin";
  return "member";
}

/**
 * 메뉴 표시, 페이지 접근 및 복귀에 같은 역할 정책을 적용한다.
 * @param path 확인할 페이지 경로.
 * @param role 유효한 최신 역할 또는 비로그인.
 * @returns 해당 역할로 페이지에 접근할 수 있으면 true.
 */
export function canAccessPage(path: string, role: PageRole): boolean {
  switch (pageAccessFor(path)) {
    case "public": return true;
    case "guest": return role === null;
    case "admin": return role === "ADMIN";
    case "member": return role !== null;
  }
}

/**
 * 외부 URL, 제어 문자, 경로 우회 표기가 없는 내부 페이지 주소만 해석한다.
 * @param value 브라우저 이동 기록 또는 요청에서 받은 주소.
 * @returns 경로와 검색 조건이 유효한 내부 주소 또는 undefined.
 */
export function parseInternalPage(value: unknown): URL | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 4096
    || /[\\#\u0000-\u0020\u007f]/.test(value)) return undefined;
  const pathname = value.split("?", 1)[0];
  if (pathname.includes("//") || /%(?:2e|2f|5c)/i.test(pathname) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)) return undefined;
  return new URL(value, "http://internal.invalid");
}

/**
 * 복귀 기록으로 취급하는 실제 서비스 화면 구조를 확인한다.
 * @param path 검증된 내부 페이지 경로.
 * @returns 홈, 마이페이지, 관리자 목록·상세 또는 회원 상세이면 true.
 */
export function isReturnablePage(path: string): boolean {
  const canonical = normalizePath(path);
  if (["/", AUTH_SUCCESS_PATH, "/admin", "/admin/g2b", "/admin/g2b/notice-queue"].includes(canonical)) return true;
  // 정확히 등록된 마이페이지 메뉴에 복귀할 수 있다.
  if (myPageMenuPaths.has(canonical)) return true;
  const match = /^\/(admin\/)?g2b\/([^/]+)(.*)$/.exec(canonical);
  if (!match) return false;
  const depth = detailSegments.get(match[2]);
  if (!depth) return false;
  // 관리자는 업무 목록도 복귀할 수 있고, 상세는 업무에 필요한 번호와 차수가 있어야 한다.
  if (!match[3]) return !!match[1];
  return match[3].slice(1).split("/").length === depth;
}

/**
 * 현재 역할로 접근 가능한 가장 최근 내부 페이지를 검색 조건과 함께 반환한다.
 * @param candidates 최근 방문 순서로 받은 탭의 페이지 기록.
 * @param current 이번에 접근이 거절된 페이지.
 * @param role 서버에서 검증한 회원의 역할.
 * @returns 안전한 이전 페이지 또는 마이페이지.
 */
export function findReturnDestination(candidates: unknown, current: unknown, role: Exclude<PageRole, null>): string {
  const denied = parseInternalPage(current);
  if (Array.isArray(candidates)) {
    // 사용자 입력의 처리량을 제한하고 확인된 서비스 경로만 사용한다.
    for (const value of candidates.slice(0, 8)) {
      const page = parseInternalPage(value);
      if (!page || (denied && normalizePath(page.pathname) === normalizePath(denied.pathname))
        || !isReturnablePage(page.pathname) || !canAccessPage(page.pathname, role)) continue;
      return page.pathname + page.search;
    }
  }
  return AUTH_SUCCESS_PATH;
}

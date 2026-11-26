/** 마이페이지 경로 식별자와 공통 표시 순서. */
export const MYPAGE_MENUS = [
  { id: "user", label: "사용자 정보" },
  { id: "business", label: "사업자 정보" },
  { id: "recommendation", label: "추천" },
  { id: "interests", label: "관심" },
] as const;

/** 등록된 마이페이지 메뉴의 경로 식별자. */
export type MyPageMenuId = (typeof MYPAGE_MENUS)[number]["id"];

/** 마이페이지 최초 진입 시 표시할 메뉴. */
export const DEFAULT_MENU_ID: MyPageMenuId = "user";

/**
 * 메뉴 식별자를 마이페이지 내부 경로로 변환한다.
 * @param id 이동할 메뉴의 식별자.
 * @returns 이동 및 접근 정책에 공통으로 사용하는 경로.
 */
export function myPageMenuPath(id: MyPageMenuId) {
  // 직접 접근과 리디렉션에 같은 URL 규칙을 적용한다.
  return `/mypage/${id}` as const;
}

/** 계정 연결 결과를 표시하는 사용자 정보 경로. */
export const MYPAGE_USER_PATH = myPageMenuPath("user");

/**
 * 등록 사업자 하나의 상세 경로를 구성한다.
 * @param id 저장된 내부 사업자 식별자.
 * @returns 목록에서 이동하고 액션에서 갱신할 상세 경로.
 */
export function myPageBusinessPath(id: number) {
  // 목록 주소의 하위 경로로 구성해 같은 마이페이지 메뉴를 유지한다.
  return `${myPageMenuPath("business")}/${id}` as const;
}

/**
 * 상세 경로와 재시도 입력에 공통으로 정수 ID 범위를 검사한다.
 * @param value URL 또는 폼에서 받은 원본 값.
 * @returns 유효한 양의 정수 또는 undefined.
 */
export function parseMyPageBusinessId(value: unknown) {
  // 다른 표기, 숫자가 아닌 값 및 안전한 정수 범위를 벗어난 입력을 거절한다.
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

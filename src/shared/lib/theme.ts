// 서버와 브라우저가 같은 이름으로 테마 설정을 읽고 저장한다.
export const THEME_COOKIE = "theme";

// 선택 가능한 테마와 메뉴에 표시할 한국어 이름을 정의한다.
export const THEME_LABELS = { light: "라이트", dark: "다크", system: "시스템" } as const;

/** 문서 속성과 브라우저 쿠키에 저장할 사용자 테마 선택값. */
export type Theme = keyof typeof THEME_LABELS;

/**
 * 외부에서 읽은 테마 값을 허용 목록과 비교해 문서와 메뉴에 사용할 설정으로 변환한다.
 * @param value 쿠키나 메뉴에서 전달된 테마 값.
 * @returns 허용된 값은 그대로, 유효하지 않거나 없는 값은 시스템 설정으로 반환한다.
 */
export function parseTheme(value: string | undefined): Theme {
  // 명시적인 라이트와 다크만 별도로 적용하고 나머지는 시스템 설정에 맡긴다.
  return value === "light" || value === "dark" ? value : "system";
}

/** 인증 화면에서 허용하는 안내 코드와 사용자용 메시지. */
export const AUTH_NOTICES = {
  cancelled: "인증을 취소했습니다. 다시 시도할 수 있습니다.",
  failed: "인증을 완료하지 못했습니다. 다시 시도해 주세요.",
  consent: "현재 필수 항목의 내용을 확인하고 동의해 주세요.",
  "signup-required": "가입된 계정이 없습니다. 필수 항목에 동의한 뒤 가입해 주세요.",
  "incomplete-profile": "선택한 계정의 확인된 이메일과 이름이 필요합니다.",
  "link-required": "같은 이메일의 계정이 있습니다. 연결할 계정을 선택하거나 별도 계정을 만들어 주세요.",
  "link-proof-failed": "선택한 계정에 연결된 인증 계정으로 확인되지 않았습니다. 다시 선택해 주세요.",
  "link-conflict": "이 인증 계정은 이미 다른 계정에 연결되어 있습니다. 로그인 화면에서 다시 시작해 주세요.",
  "registered-session-failed": "회원가입이 완료되었습니다. 자동 로그인에 실패했으니 다시 로그인해 주세요.",
  "session-failed": "로그인 세션을 만들지 못했습니다. 다시 로그인해 주세요.",
  unavailable: "인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
} as const;

/** OAuth 진행이 끝났을 때 표시 가능한 안내 코드. */
export type AuthNotice = keyof typeof AUTH_NOTICES;

/**
 * URL의 안내 코드를 허용된 메시지로 바꾼다.
 * @param value 중복 값도 들어올 수 있는 외부 쿼리 입력.
 * @returns 허용된 단일 코드에 해당하는 메시지 또는 표시할 안내가 없으면 undefined.
 */
export function authNoticeMessage(value: string | string[] | undefined): string | undefined {
  // 등록된 단일 코드만 사용해 임의 입력이나 서버 오류를 화면에 표시하지 않는다.
  if (typeof value === "string" && Object.hasOwn(AUTH_NOTICES, value)) return AUTH_NOTICES[value as AuthNotice];
}

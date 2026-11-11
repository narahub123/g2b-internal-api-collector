import { formatG2bPhone } from "../g2b-phone";

/** 숫자 표시에 사용하는 자릿수별 포맷터. */
const numberFormats = {
  0: new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }),
  2: new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }),
  3: new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 3 }),
};

/**
 * 금액·수량 문자열에 천 단위 구분과 최대 소수 자릿수를 적용한다.
 * @param value 화면에 표시할 원본 문자열.
 * @param maximumFractionDigits 필드에서 허용하는 최대 소수 자릿수.
 * @returns 변환된 표시값 또는 숫자로 인식되지 않은 원본 문자열.
 */
export function formatG2bDisplayNumber(
  value: string,
  maximumFractionDigits: 0 | 2 | 3,
): string {
  const amount = value.trim();
  // 큰 금액의 정밀도를 보존하도록 Number로 변환하지 않고 문자열을 전달한다.
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(amount)
    ? numberFormats[maximumFractionDigits].format(amount as `${number}`)
    : value;
}

/**
 * 비율의 정수부를 천 단위로 구분하고 소수부의 자릿수와 끝자리 0을 보존한다.
 * @param value 백분율 단위 기호가 없는 원본 문자열.
 * @returns 변환된 표시값 또는 일반 소수 표기가 아닌 원본 문자열.
 */
export function formatG2bDisplayRate(value: string): string {
  const match = /^([+-]?\d+)(\.\d+)?$/.exec(value.trim());
  if (!match) return value;

  const [, integer, fraction = ""] = match;
  return formatG2bDisplayNumber(integer, 0) + fraction;
}

/**
 * 연월 또는 일자를 슬래시로 구분한 표시값으로 변환한다.
 * @param value 호출부에서 전처리한 날짜 문자열.
 * @param format 연월 또는 일자 필드의 표시 단위. 일자는 시간 접미사를 제외한다.
 * @returns 변환된 표시값 또는 지원 형식과 일치하지 않는 원본 문자열.
 */
export function formatG2bDisplayDate(
  value: string,
  format: "month" | "date",
): string {
  return format === "month"
    ? value.replace(/^(\d{4})(\d{2})$/, "$1/$2")
    : value.replace(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[ T].*)?$/, "$1/$2/$3");
}

/**
 * 일시를 슬래시 날짜와 콜론 시각으로 표시한다.
 * @param value 구분자가 있거나 연월일시분(초)이 이어진 일시 문자열.
 * @returns 입력의 분·초 정밀도를 유지한 표시값. 지원하지 않는 형식은 원본을 반환한다.
 */
export function formatG2bDisplayDateTime(value: string): string {
  const dateTime = value.trim();
  const separated =
    /^(\d{4})([-/])(\d{2})\2(\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(dateTime);
  if (separated) {
    const [, year, , month, day, hour, minute, second] = separated;
    return `${year}/${month}/${day} ${hour}:${minute}${second ? `:${second}` : ""}`;
  }

  // 시간대가 붙거나 형태가 다른 값은 원문을 보존한다.
  const compact =
    /^(\d{4})(\d{2})(\d{2})([01]\d|2[0-3])([0-5]\d)([0-5]\d)?$/.exec(dateTime);
  if (!compact) return value;

  const [, year, month, day, hour, minute, second] = compact;
  return `${year}/${month}/${day} ${hour}:${minute}${second ? `:${second}` : ""}`;
}

/** 화면의 필드 정의에서 선택할 공통 표시 형식. */
export type G2bDisplayFormat =
  | "integer"
  | "decimal"
  | "date"
  | "dateTime"
  | "phone";

/**
 * 표시 문자열에 필드별 공통 포맷을 적용한다.
 * @param value 표시 단계에서 문자열로 준비한 값.
 * @param format 필드에 선언된 형식. decimal은 원본 소수 자릿수를 보존한다.
 * @returns 선택한 형식의 표시값.
 */
export function formatG2bDisplayText(
  value: string,
  format?: G2bDisplayFormat,
): string {
  switch (format) {
    case "integer":
      return formatG2bDisplayNumber(value, 0);
    case "decimal":
      return formatG2bDisplayRate(value);
    case "date":
      return formatG2bDisplayDate(value.trim(), "date");
    case "dateTime":
      return formatG2bDisplayDateTime(value);
    case "phone":
      return formatG2bPhone(value) ?? value;
    default:
      return value;
  }
}

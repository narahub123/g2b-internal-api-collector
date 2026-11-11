import { decodeHTMLStrict } from "entities";

// MainBidPbancM.js의 입찰공고 상세 분류를 사용한다. 물품은 수집 응답의 명칭으로 표시한다.
const businessLabels = {
  "01": "물품(내자)",
  "02": "물품(외자)",
  "03": "일반용역",
  "04": "일반용역(외자)",
  "05": "기술용역",
  "07": "공사",
  "09": "기타",
  "10": "리스(내자)",
  "11": "리스(외자)",
  "12": "비축(내자)",
  "13": "비축(외자)",
  "14": "리스(일반용역)",
} as const;

export type G2bBusiness = {
  label: string;
  code?: keyof typeof businessLabels;
};

/**
 * 수집 원본을 변경하지 않고 업무구분 배지의 문구와 색상 키를 결정한다.
 * 등록 코드가 우선이며, 명칭만 있는 경우 같은 명칭에 등록된 색상을 사용한다.
 *
 * @returns 표시할 명칭이 없으면 undefined. 미등록 명칭에는 색상 키가 없다.
 */
export function resolveG2bBusiness(
  rawCode: unknown,
  rawLabel: unknown,
): G2bBusiness | undefined {
  const value = typeof rawCode === "string" || typeof rawCode === "number"
    ? String(rawCode).trim()
    : "";
  // 개찰 조회는 앞자리 0이 생략된 외자 코드도 저장할 수 있다.
  const code = value === "2" ? "02" : value;
  if (Object.hasOwn(businessLabels, code)) {
    const registeredCode = code as keyof typeof businessLabels;
    return { code: registeredCode, label: businessLabels[registeredCode] };
  }

  const label = typeof rawLabel === "string" ? decodeHTMLStrict(rawLabel).trim() : "";
  if (!label) return undefined;
  if (label === "내자") return { code: "01", label: businessLabels["01"] };
  if (label === "외자") return { code: "02", label: businessLabels["02"] };
  const match = (Object.keys(businessLabels) as (keyof typeof businessLabels)[])
    .find((key) => businessLabels[key] === label);
  return { label, code: match };
}

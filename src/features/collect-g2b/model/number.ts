import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";

// 개찰결과는 입찰공고번호로 조회하며, 계약요청은 별도 접수번호 체계를 사용한다.
const numberFormats = {
  notices: { label: "입찰공고번호", stage: "BK" },
  "opening-results": { label: "공고번호", stage: "BK" },
  contracts: { label: "계약번호", stage: "TA" },
  "order-plans": { label: "발주계획번호", stage: "DD" },
  "prior-specs": { label: "사전규격등록번호", stage: "BD" },
} satisfies Record<
  Exclude<CollectionSection, "contract-requests">,
  { label: string; stage: string }
>;

// 다른 업무 번호가 입력되었을 때 사용자에게 표시할 명칭.
const stageLabels: Record<string, string> = {
  BK: "입찰공고번호",
  TA: "계약번호",
  DD: "발주계획번호",
  BD: "사전규격등록번호",
};

const NUMBER_PATTERN = /^R[0-9]{2}[A-Z]{2}[0-9]{8}$/;

/**
 * 직접 수집과 재시도에서 차세대 번호의 형식과 업무별 단계 코드를 검사한다.
 * 다른 업무의 정상 번호라면 해당 업무를 안내한다.
 * @param number 정규화된 번호. 이 함수는 입력값을 변경하지 않는다.
 * @returns 형식 오류 안내. 유효하거나 계약요청이면 undefined.
 */
export function collectionNumberError(
  section: CollectionSection,
  number: unknown,
): string | undefined {
  if (section === "contract-requests") return;

  const { label, stage } = numberFormats[section];
  const example = `R26${stage}00000001`;
  const defaultError = `${label} 형식을 확인하세요. 예시 ${example}`;

  if (typeof number !== "string" || !NUMBER_PATTERN.test(number)) {
    return defaultError;
  }

  const inputStage = number.slice(3, 5);

  if (inputStage === stage) return;

  const inputLabel = stageLabels[inputStage];

  if (inputLabel) {
    return `입력한 번호는 ${inputLabel}입니다. ${label}를 입력해 주세요. 예시: ${example}`;
  }

  return defaultError;
}

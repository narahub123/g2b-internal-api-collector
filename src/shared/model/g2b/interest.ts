import { G2B_SECTIONS } from "@/shared/config/g2b-sections";

/** 관심을 등록할 수 있는 업무를 기존 메뉴 순서대로 정의한다. */
export const INTEREST_TYPES = [
  "order-plans", "contract-requests", "prior-specs", "notices", "opening-results", "contracts",
] as const satisfies readonly (keyof typeof G2B_SECTIONS)[];

/** 사용자 및 관리자 상세가 같은 키로 참조하는 관심 업무 유형이다. */
export type InterestType = typeof INTEREST_TYPES[number];

/** 사용자나 화면 경로와 독립적인 업무 식별자다. */
export type InterestKey = {
  /** 원본 업무의 유형이다. */
  type: InterestType;
  /** 원본의 번호다. */
  number: string;
  /** 원본의 차수이며, 차수가 없으면 빈 문자열이다. */
  revision: string;
};

/** 원본 조회 없이 관심 목록에 표시할 등록 당시의 데이터다. */
export type InterestItem = InterestKey & {
  /** 등록 시 저장한 제목이다. */
  title: string;
  /** 최신순 정렬에 사용하는 UTC 등록일시다. */
  registeredAt: string;
};

/**
 * 외부에서 전달된 유형을 등록 가능한 공통 유형으로 좁힌다.
 * @param value 주소나 Action으로 전달된 업무 유형.
 * @returns 목록에 있는 유형인지 여부.
 */
export function isInterestType(value: unknown): value is InterestType {
  // 유형 목록에 있는 값만 상세 주소와 저장 조건에 사용할 수 있다.
  return INTEREST_TYPES.some((type) => type === value);
}

import type { ConsentPolicy } from "@/shared/config/auth";
import type { ConsentRenewal } from "./types";

/** 버전과 선택 여부만 갱신 판단에 사용한다. */
type LatestConsent = { version: string; agreed: boolean };

/**
 * 시행된 재동의 정책마다 최신 동의를 확인해 세션에 담을 갱신 상태를 계산한다.
 * @param policies 로그인 시 적용할 항목별 정책.
 * @param findLatest 해당 항목의 최신 동의 한 건을 읽는 함수.
 * @param now 시행과 마감 여부를 비교할 Unix 밀리초.
 * @returns 갱신 대상이 있으면 required, 대상 중 마감이 지난 항목이 있으면 overdue가 참이다.
 * @throws 동의 이력 조회가 실패하면 오류를 호출자에게 전달한다.
 */
export async function evaluateConsentRenewal(
  policies: readonly ConsentPolicy[],
  findLatest: (itemId: string) => Promise<LatestConsent | undefined>,
  now = Date.now(),
): Promise<ConsentRenewal> {
  // 시행된 재동의 정책이 없는 경우 동의 이력을 조회하지 않는다.
  const active = policies.filter((item) => item.requiresRenewal && Date.parse(item.effectiveAt) <= now);
  const summary = { required: false, overdue: false };
  for (const item of active) {
    // 항목별 기록을 최신순 인덱스로 한 건만 읽는다.
    const consent = await findLatest(item.id);
    if (consent?.agreed && consent.version === item.version) continue;
    // 동의가 누락됐거나 최신 버전을 동의하지 않았으면 갱신 대상으로 표시한다.
    summary.required = true;
    if (item.renewalDeadline && now > Date.parse(item.renewalDeadline)) {
      // 전체 결과가 확정되면 이후 항목의 불필요한 조회를 건너뛴다.
      return { required: true, overdue: true };
    }
  }
  return summary;
}

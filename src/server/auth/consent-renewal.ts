import type { ConsentPolicy } from "@/shared/config/auth";
import type { ConsentRenewal } from "./types";

/** 버전과 선택 여부만 갱신 판단에 사용한다. */
type LatestConsent = { version: string; agreed: boolean };

/**
 * 시행 중인 정책과 최신 동의를 비교해 해당 문서를 다시 확인해야 하는지 판단한다.
 * @param policy 문서의 버전, 시행일 및 재동의가 필요한 조건.
 * @param consent 최신 기록 또는 아직 제출한 기록이 없으면 undefined.
 * @param now 시행 여부를 비교할 Unix 밀리초.
 * @returns 마이페이지와 세션에서 같은 문서를 재동의 대상으로 판단하면 true.
 */
export function needsConsentRenewal(policy: ConsentPolicy, consent: LatestConsent | undefined, now: number) {
  // 재동의를 요청하지 않는 정책과 아직 시행하지 않은 문서는 제외한다.
  if (!policy.requiresRenewal || Date.parse(policy.effectiveAt) > now) return false;
  // 선택 미동의와 철회는 사용자의 선택이므로 재동의를 요구하지 않는다.
  if (!consent?.agreed) return policy.required;
  // 동의한 문서는 시행 중인 버전으로 다시 확인해야 하는 경우만 남긴다.
  return consent.version !== policy.version;
}

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
    if (!needsConsentRenewal(item, consent, now)) continue;
    // 정책과 최신 상태가 일치하지 않는 재동의 대상만 집계한다.
    summary.required = true;
    if (item.renewalDeadline && now > Date.parse(item.renewalDeadline)) {
      // 전체 결과가 확정되면 이후 항목의 불필요한 조회를 건너뛴다.
      return { required: true, overdue: true };
    }
  }
  return summary;
}

import type { ConsentPolicy } from "@/shared/config/auth";
import type { G2bDatabase } from "@/server/g2b/repository/database";
import { evaluateConsentRenewal, needsConsentRenewal } from "./consent-renewal";
import { activeConsentPolicies, type SignupConsent } from "./enrollment";
import { openAuthRepository } from "./repository";
import type { ConsentRenewal } from "./types";

/** 동의 관리 화면에 내려갈 현재 문서와 사용자 상태. */
export type ManagedConsent = {
  // 화면 키와 제출에 사용할 정책 식별자.
  id: string;
  // Dialog와 목록에서 사용할 문서명.
  title: string;
  // 저장 전에 현재 정책과 대조할 버전.
  version: string;
  // 선택 동의 철회를 제공할지 판단하는 필수 구분.
  required: boolean;
  // 해당 사용자에게 동의 또는 재동의가 필요한 경우에만 전달하는 문서 원문.
  content: string | null;
  // 최신 이력에서 확인한 실제 동의 상태.
  agreed: boolean;
  // 최신 동의 날짜의 Unix 밀리초. 미동의와 철회는 null.
  agreedAt: number | null;
  // 현재 정책의 재동의 조건이 충족됐는지 나타낸다.
  renewal: boolean;
};

/** 저장 또는 정책 검증 결과. */
type ConsentChangeResult =
  // 최신 기록이 요청과 일치할 때 현재 세션에 적용할 상태.
  | { status: "saved"; renewal: ConsentRenewal }
  // 지원하지 않는 항목·철회 또는 현재 버전과 다른 제출.
  | { status: "invalid" | "stale" };

/**
 * 시행 중인 정책 순서로 사용자 동의 상태를 만들고 동의 가능한 원문만 포함한다.
 * @param repository 최신 이력 목록을 읽는 저장소.
 * @param userId 인증을 완료한 내부 사용자 ID.
 * @param policies 문서와 표시 순서를 정의한 정책.
 * @param now 시행 및 재동의 판단 시각의 Unix 밀리초.
 * @returns 문서별 표시 상태와 같은 이력으로 계산한 세션 재동의 상태.
 * @throws 저장소의 조회 오류를 전달한다.
 */
export async function loadConsentManagement(repository: Pick<ReturnType<typeof openAuthRepository>, "listLatestConsents">,
  userId: string, policies: readonly ConsentPolicy[], now = Date.now()) {
  // 현재 화면에 표시할 문서의 최신 이력만 조회한다.
  const active = activeConsentPolicies(policies, now);
  const latest = await repository.listLatestConsents(userId, active.map((item) => item.id));
  const items = active.map((policy): ManagedConsent => {
    // 기존 기록의 표시 상태와 현재 문서의 재동의 대상 여부를 각각 계산한다.
    const record = latest.get(policy.id);
    const agreed = record?.agreed ?? false;
    const renewal = needsConsentRenewal(policy, record, now);
    return {
      id: policy.id, title: policy.title, version: policy.version, required: policy.required,
      content: !agreed || renewal ? policy.content : null, agreed, agreedAt: record?.agreedAt ?? null, renewal,
    };
  });
  // 브라우저를 새로 열어도 이미 저장된 동의와 세션의 차이를 추가 조회 없이 확인한다.
  const renewal = await evaluateConsentRenewal(active, async (id) => latest.get(id), now);
  return { items, renewal };
}

/**
 * 제출 버전을 다시 검증하고 최신 기록과 다른 동의·철회만 이력으로 남긴다.
 * @param database 조회와 쓰기를 같은 트랜잭션으로 실행하는 DB.
 * @param userId 인증을 완료한 내부 사용자 ID.
 * @param policies 서버가 현재 적용하는 정책 목록.
 * @param input 확인 Dialog에서 제출한 항목, 버전 및 선택.
 * @param now 검증과 기록에 사용할 기준 시각의 Unix 밀리초.
 * @returns 저장된 현재 재동의 상태 또는 문서·철회 정책 오류.
 * @throws 조회·저장에 실패하면 트랜잭션을 롤백하고 오류를 전달한다.
 */
export async function recordConsentChange(database: Pick<G2bDatabase, "execute" | "transaction">,
  userId: string, policies: readonly ConsentPolicy[], input: SignupConsent, now = Date.now()): Promise<ConsentChangeResult> {
  // 현재 시행 중인 문서의 버전과 필수 철회 규칙을 DB에 접근하기 전에 검사한다.
  const policy = activeConsentPolicies(policies, now).find((item) => item.id === input.id);
  if (!policy || (!input.agreed && policy.required)) return { status: "invalid" };
  if (input.version !== policy.version) return { status: "stale" };
  const repository = openAuthRepository(database);
  return database.transaction(async () => {
    // 쓰기 권한을 얻은 뒤 최신 이력을 다시 조회해 재시도와 동시 작업의 중복을 방지한다.
    const previous = await repository.findLatestConsent(userId, policy.id);
    const changed = input.agreed ? !previous?.agreed || needsConsentRenewal(policy, previous, now) : previous?.agreed;
    if (changed) {
      // 같은 시각은 행 ID가 구분하며 서버 시간 차이로 새 사건이 이전 기록 뒤로 밀리지 않게 한다.
      await repository.appendConsent(userId, input, input.agreed ? now : null, Math.max(now, previous?.createdAt ?? now));
    }
    // 제출 항목은 같은 트랜잭션에서 방금 읽고 반영한 결과를 사용한다.
    const renewal = await evaluateConsentRenewal(policies, async (itemId) =>
      itemId === policy.id ? (changed ? input : previous) : repository.findLatestConsent(userId, itemId), now);
    return { status: "saved", renewal };
  });
}

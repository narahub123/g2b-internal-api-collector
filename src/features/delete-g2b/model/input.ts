import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import type { CollectionDeletionTarget } from "@/server/g2b/repository/collection-deletion";
import { COLLECTION_LIST_PAGE_SIZE } from "@/shared/config/collection-list";
import { contractRevision } from "@/entities/contract/model/contract";

const sections = {
  "order-plans": true,
  "prior-specs": true,
  notices: true,
  "contract-requests": true,
  "opening-results": true,
  contracts: true,
} satisfies Record<CollectionSection, true>;

function validRevision(section: CollectionSection, revision: string) {
  if (section === "order-plans" || section === "prior-specs") return revision === "";
  if (section === "contracts") return contractRevision(revision) === revision;
  return /^\d{3}$/.test(revision);
}

/**
 * 관리자 상세 또는 한 페이지에서 제출한 업무별 저장 키와 화면 조회 버전을 검증한다.
 * @returns 중복 키나 규격 밖의 요청이면 null, 유효하면 저장소에 전달할 대상 배열.
 */
export function parseCollectionDeletion(section: unknown, input: unknown) {
  if (typeof section !== "string" || !Object.hasOwn(sections, section) ||
    !Array.isArray(input) || !input.length || input.length > COLLECTION_LIST_PAGE_SIZE) return null;

  const selectedSection = section as CollectionSection;
  const targets: CollectionDeletionTarget[] = [];
  const keys = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const { number, revision, openingRevision, collectedAt, attemptId, attemptStartedAt } =
      item as Partial<CollectionDeletionTarget>;
    // 수집 API가 형식이 다른 조회 번호도 이력에 남기므로 원래 저장 키를 그대로 받는다.
    if (typeof number !== "string" || !number.trim() ||
      typeof revision !== "string" || !validRevision(selectedSection, revision) ||
      typeof openingRevision !== "string" ||
      (selectedSection === "opening-results" ? !/^\d{3}$/.test(openingRevision) : openingRevision !== "") ||
      !validVersion(collectedAt) || !validVersion(attemptStartedAt) ||
      (attemptId === null ? attemptStartedAt !== null :
        typeof attemptId !== "number" || !Number.isSafeInteger(attemptId) || attemptId < 1 || attemptStartedAt === null) ||
      (collectedAt === null && attemptId === null)) return null;

    const key = JSON.stringify([number, revision, openingRevision]);
    if (keys.has(key)) return null;
    keys.add(key);
    targets.push({ number, revision, openingRevision, collectedAt, attemptId, attemptStartedAt });
  }
  return { section: selectedSection, targets };
}

function validVersion(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= 100);
}

/**
 * 루프백 바인딩에서 같은 출처로 제출한 브라우저 요청만 허용한다.
 * 원본 Host를 사용해 전달 헤더가 로컬 주소를 대신할 수 없게 한다.
 */
export function isLocalDeletionRequest(headers: Pick<Headers, "get">) {
  const host = headers.get("host");
  const origin = headers.get("origin");
  return Boolean(host && /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/i.test(host) &&
    (origin === `http://${host}` || origin === `https://${host}`));
}

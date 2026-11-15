import type { ReactNode } from "react";
import { DeleteCollectionDetailButton } from "@/features/delete-g2b/ui/DeleteCollectionDetailButton";
import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { ADMIN_G2B_PATH } from "../../config/routes";

/**
 * 관리자 상세에 재수집과 삭제를 함께 표시한다. 삭제 버전은 화면에 렌더링하는 원본의 수집 시각을 사용한다.
 * @throws SQLite에서 최신 수집 상태를 확인하지 못한 경우.
 */
export function CollectionDetailActions({ section, records, children }: {
  section: CollectionSection;
  records: { number: string; revision?: string; openingRevision?: string; collectedAt: string }[];
  children: ReactNode;
}) {
  const deletion = getG2bRepository().collectionDeletion;
  const entries = records.map(({ number, revision = "", openingRevision = "", collectedAt }) => {
    const { target, blocked } = deletion.snapshot(section, { number, revision, openingRevision });
    return { target: { ...target, collectedAt }, blocked: blocked || target.collectedAt !== collectedAt };
  });
  return (
    <div className="flex items-start gap-2">
      {children}
      <DeleteCollectionDetailButton section={section} entries={entries} listHref={`${ADMIN_G2B_PATH}/${section}`} />
    </div>
  );
}

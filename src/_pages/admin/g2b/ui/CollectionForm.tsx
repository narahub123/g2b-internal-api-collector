"use client";

import { useRouter } from "next/navigation";
import { CollectG2bForm } from "@/features/collect-g2b";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { collectionDetailPaths } from "../../config/routes";

/**
 * 업무 목록에 수집 폼을 배치하고 결과에 따라 상세 이동 또는 현재 목록 갱신을 수행한다.
 */
export function CollectionForm({ section }: { section: CollectionSection }) {
  const router = useRouter();
  return (
    <CollectG2bForm
      section={section}
      onCollected={(key) => router.push(collectionDetailPaths[section](key))}
      onFailure={() => router.refresh()}
    />
  );
}

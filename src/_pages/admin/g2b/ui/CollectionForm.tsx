"use client";

import { useRouter } from "next/navigation";
import { CollectG2bForm } from "@/features/collect-g2b";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { collectionDetailPaths } from "../../config/routes";
import { refreshCollectionNavigation } from "../actions/refresh-collection-navigation";
import { handleBusinessFailure } from "@/features/service-auth/business-client";
import { withSessionCookieWrite } from "@/features/service-auth/session-writes";

/**
 * 수집 성공 시 이전 목록의 갱신을 기다린 뒤 상세로 이동한다.
 * 수집 실패 시 부분 저장을 반영하도록 현재 목록을 갱신하고, 성공 후 갱신 오류는 수집 폼에 전달한다.
 */
export function CollectionForm({ section }: { section: CollectionSection }) {
  const router = useRouter();
  return (
    <CollectG2bForm
      section={section}
      onCollected={async (key) => {
        const failure = await withSessionCookieWrite(refreshCollectionNavigation);
        if (failure) {
          handleBusinessFailure(failure);
          return;
        }
        router.push(collectionDetailPaths[section](key));
      }}
      onFailure={() => router.refresh()}
    />
  );
}

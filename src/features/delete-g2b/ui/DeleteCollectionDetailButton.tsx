"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import type { CollectionDeletionTarget } from "@/server/g2b/repository/collection-deletion";
import { formatCollectionIdentifier } from "@/shared/model/g2b/collection-list-query";
import { Button } from "@/shared/ui/button";
import { DeleteCollectionDialog } from "./DeleteCollectionDialog";

/**
 * 상세의 삭제 동작을 표시한다. 개찰결과는 같은 상세에 표시된 차수 중 한 건을 확인창에서 선택한다.
 * @param props.listHref 마지막 저장 건을 지웠을 때 이동할 관리자 목록 경로.
 */
export function DeleteCollectionDetailButton({ section, entries, listHref }: {
  section: CollectionSection;
  entries: { target: CollectionDeletionTarget; blocked: boolean }[];
  listHref: string;
}) {
  const router = useRouter();
  const selectId = useId();
  const [openingRevision, setOpeningRevision] = useState("");
  const opening = section === "opening-results";
  const entry = opening
    ? entries.find(({ target }) => target.openingRevision === openingRevision)
    : entries[0];
  const canDelete = entries.some(({ blocked }) => !blocked);
  return (
    <DeleteCollectionDialog
      section={section}
      targets={entry && !entry.blocked ? [entry.target] : []}
      description={entry ? `${formatCollectionIdentifier(entry.target)} 자료를 삭제하시겠습니까?`
        : "삭제할 개찰차수를 선택해 주세요."}
      trigger={
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="삭제"
          title={canDelete ? "삭제" : "수집 중이거나 결과가 미확인된 대상입니다."}
          className="text-destructive"
          disabled={!canDelete}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      }
      onOpen={() => setOpeningRevision("")}
      onDeleted={({ hasOtherOpeningResults }) => {
        if (!hasOtherOpeningResults) router.replace(listHref);
      }}
    >
      {opening && (
        <div className="grid gap-2">
          <label htmlFor={selectId} className="text-sm font-medium">개찰차수</label>
          <select
            id={selectId}
            value={openingRevision}
            onChange={(event) => setOpeningRevision(event.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="" disabled>개찰차수 선택</option>
            {entries.map(({ target, blocked }) => (
              <option key={target.openingRevision} value={target.openingRevision} disabled={blocked}>
                {target.openingRevision}차{blocked ? " (삭제 불가)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
    </DeleteCollectionDialog>
  );
}

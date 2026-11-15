"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import type { CollectionDeletionTarget } from "@/server/g2b/repository/collection-deletion";
import { formatCollectionIdentifier } from "@/shared/model/g2b/collection-list-query";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { DeleteCollectionDialog } from "./DeleteCollectionDialog";

const SelectionContext = createContext<{
  selected: Set<string>;
  toggle: (id: string, checked: boolean) => void;
} | null>(null);

/**
 * 현재 페이지에서 삭제 가능한 대상의 선택과 전체 선택을 관리한다.
 * 호출 화면은 목록 조회 조건이 바뀌면 이 컴포넌트의 키를 교체한다.
 */
export function CollectionListSelection({
  section,
  eligible,
  children,
}: {
  section: CollectionSection;
  eligible: CollectionDeletionTarget[];
  children: ReactNode;
}) {
  const allId = useId();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const targets = eligible.filter((target) =>
    selected.has(formatCollectionIdentifier(target)),
  );
  const allChecked =
    targets.length === 0
      ? false
      : targets.length < eligible.length
        ? "indeterminate"
        : true;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <SelectionContext.Provider value={{ selected, toggle }}>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4 px-4 rounded-md border bg-card shadow-xs py-2">
            <Checkbox
              id={allId}
              checked={allChecked}
              disabled={!eligible.length}
              onCheckedChange={(checked) =>
                setSelected(
                  new Set(
                    checked === true
                      ? eligible.map(formatCollectionIdentifier)
                      : [],
                  ),
                )
              }
            />
            <label htmlFor={allId} className="text-sm">
              현재 페이지 전체 선택
            </label>
          </div>
          <DeleteCollectionDialog
            section={section}
            targets={targets}
            description={`선택한 ${targets.length}건을 삭제하시겠습니까?`}
            trigger={
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                disabled={!targets.length}
              >
                선택 삭제 ({targets.length}건)
              </Button>
            }
            onDeleted={() => setSelected(new Set())}
          />
        </div>
        {children}
      </div>
    </SelectionContext.Provider>
  );
}

/**
 * 목록 행의 선택 상태를 전체 선택과 동기화한다.
 * 삭제할 수 없는 행은 사유가 포함된 비활성 체크박스로 표시한다.
 */
export function CollectionRowCheckbox({
  identifier,
  disabled,
}: {
  identifier: string;
  disabled: boolean;
}) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <Checkbox
      aria-label={disabled ? `${identifier} 삭제 불가` : `${identifier} 선택`}
      checked={!disabled && selection.selected.has(identifier)}
      disabled={disabled}
      onCheckedChange={(checked) =>
        selection.toggle(identifier, checked === true)
      }
    />
  );
}

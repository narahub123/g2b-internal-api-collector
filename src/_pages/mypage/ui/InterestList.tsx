"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { decodeHTMLStrict } from "entities";
import { toast } from "sonner";
import { userDetailPath } from "@/_pages/g2b/config/routes";
import { removeInterests } from "@/features/g2b-interest/actions";
import { InterestButton } from "@/features/g2b-interest/InterestButton";
import { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { myPageMenuPath } from "@/shared/config/mypage";
import { INTEREST_TYPES, type InterestItem, type InterestType } from "@/shared/model/g2b/interest";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { ListView } from "@/shared/ui/list-controls/ListView";

/**
 * 필터와 페이지를 관심 목록 주소로 변환한다.
 * @param type 선택한 업무 유형. 전체이면 생략한다.
 * @param page 이동할 페이지. 첫 페이지이면 생략한다.
 * @returns 관심 목록 내부 주소.
 */
function interestHref(type?: InterestType, page = 1) {
  // 기본 조건은 주소에서 생략하고 페이지 이동에서 선택한 유형을 보존한다.
  const query = new URLSearchParams();
  if (type) query.set("type", type);
  if (page > 1) query.set("page", String(page));
  // 공통 마이페이지 메뉴 경로를 사용한다.
  const path = myPageMenuPath("interests");
  return query.size ? `${path}?${query}` : path;
}

/**
 * 한 페이지 안에서 선택과 렌더링에 사용할 업무 키를 만든다.
 * @param item 현재 목록의 관심 항목.
 * @returns 업무 유형·번호·차수 조합.
 */
function rowKey(item: InterestItem) {
  // 번호와 차수에 포함될 수 없는 구분자로 필드 경계를 구분한다.
  return `${item.type}/${item.number}/${item.revision}`;
}

/** 같은 유형과 페이지가 다시 렌더링될 때 적용할 목록 데이터다. */
type InterestListProps = {
  /** 서버에서 조회한 현재 페이지의 관심 항목이다. */
  items: InterestItem[];
  /** 전체 목록이면 undefined이며 업무 필터의 활성 상태에 사용한다. */
  type?: InterestType;
  /** 실제 항목이 있는 마지막 페이지로 보정한 페이지다. */
  page: number;
  /** 현재 업무 유형에서 이동할 수 있는 마지막 페이지다. */
  totalPages: number;
  /** 주소에 있던 페이지 번호로, 삭제 후 주소 보정에 사용한다. */
  requestedPage: number;
};

/**
 * 관심 목록의 필터·이동 및 선택 항목 변경을 연결한다.
 * @param props 서버가 현재 로그인 사용자와 주소 조건으로 읽은 목록.
 * @returns 업무 링크, 별 버튼, 선택 및 일괄 삭제가 있는 목록.
 */
export function InterestList({ items, type, page, totalPages, requestedPage }: InterestListProps) {
  // 부모가 페이지와 업무 유형으로 인스턴스를 구분하므로 다른 목록의 선택을 이어받지 않는다.
  const [selected, setSelected] = useState<string[]>([]);
  // 확인창과 일괄 삭제의 진행 상태를 분리해 실패 시 사용자가 다시 시도할 수 있게 한다.
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  // 삭제된 행은 현재 서버 목록에서 사라지므로 선택과 확인 건수에서도 빼준다.
  const targets = items.filter((item) => selected.includes(rowKey(item)));
  const allSelected = items.length > 0 && items.length === targets.length;
  // 삭제로 빈 페이지의 주소를 보정할 때 기록을 추가하지 않는다.
  const router = useRouter();

  useEffect(() => {
    // 서버가 보정된 페이지를 이미 표시한 상태에서 현재 주소만 교체한다.
    if (page !== requestedPage) router.replace(interestHref(type, page), { scroll: false });
  }, [page, requestedPage, router, type]);

  /**
   * 클릭한 행만 선택하거나 선택을 해제한다.
   * @param id 현재 페이지의 업무 키.
   */
  function toggleItem(id: string) {
    // 같은 페이지의 다른 행 선택은 보존한다.
    setSelected((current) => current.includes(id) ? current.filter((key) => key !== id) : [...current, id]);
  }

  /** 현재 페이지에 표시된 항목만 한 번에 선택하거나 선택을 해제한다. */
  function toggleAll() {
    // 페이지의 업무 키를 복사해 다른 페이지나 유형의 키를 포함하지 않는다.
    setSelected(allSelected ? [] : items.map(rowKey));
  }

  /** 확인창의 선택 건수를 서버에 전달하고 실제로 삭제된 건수를 알린다. */
  function confirmRemoval() {
    // 확인 직전에 목록을 떠났거나 이미 처리 중인 선택은 재전송하지 않는다.
    if (!targets.length || pending) return;
    // 현재 화면에 있는 선택 항목에서 원본을 가리키는 필드만 보낸다.
    const keys = targets.map(({ type, number, revision }) => ({ type, number, revision }));
    startTransition(async () => {
      try {
        // 서버가 일괄 삭제를 완료하면 목록과 페이지 수를 다시 읽는다.
        const result = await removeInterests(keys);
        if (!result.ok) {
          // 실패한 선택을 유지해 같은 확인창에서 다시 시도할 수 있다.
          toast.error(result.error);
          return;
        }
        // 성공한 선택은 초기화하고 실제 삭제 건수를 표시한다.
        setSelected([]);
        setConfirming(false);
        toast.success(`선택한 관심 항목 ${result.count}건이 제거되었습니다.`);
      } catch {
        // 통신 오류가 발생하면 확인창을 유지한다.
        toast.error("선택한 관심 항목을 삭제하지 못했습니다.");
      }
    });
  }

  // 유형은 URL로 이동하고 페이지 링크는 현재 유형을 보존한다.
  return (
    <div className="grid gap-4">
      <nav aria-label="관심 업무 유형" className="flex flex-wrap gap-2">
        {([undefined, ...INTEREST_TYPES] as const).map((option) => (
          <Button key={option ?? "all"} asChild size="sm" variant={option === type ? "default" : "outline"}>
            <Link href={interestHref(option)} aria-current={option === type ? "page" : undefined} prefetch={false}>
              {option ? G2B_SECTIONS[option] : "전체"}
            </Link>
          </Button>
        ))}
      </nav>
      {/* 개별 해제는 즉시 실행하고 선택 항목을 삭제할 때만 확인창을 연다. */}
      <AlertDialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <ListView pagination={{
          page, totalPages,
          /** @param nextPage 선택한 페이지 번호. @returns 현재 유형이 유지된 목록 주소. */
          hrefForPage: (nextPage) => interestHref(type, nextPage),
        }}>
          {items.length ? (
            <>
              {/* 현재 페이지에 항목이 있을 때 선택과 일괄 삭제를 제공한다. */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={allSelected} disabled={pending} onChange={toggleAll} />
                  전체 선택
                </label>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="sm" disabled={!targets.length || pending}>
                    선택 삭제
                  </Button>
                </AlertDialogTrigger>
              </div>
              <ul className="divide-y rounded-lg border">
                {items.map((item) => {
                  // 목록에 저장된 제목을 상세 제목과 같은 방식으로 표시한다.
                  const title = decodeHTMLStrict(item.title);
                  const id = rowKey(item);
                  // 원본 조회 없이 업무 키로 회원용 상세 주소를 만든다.
                  const href = userDetailPath(item.type, item);
                  return (
                    <li key={id} className="flex min-w-0 items-center gap-3 p-3">
                      <input type="checkbox" checked={selected.includes(id)} disabled={pending}
                        aria-label={`${title} 선택`} onChange={() => toggleItem(id)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">{G2B_SECTIONS[item.type]}</p>
                        <Link href={href} prefetch={false} className="wrap-anywhere font-medium hover:underline">{title}</Link>
                      </div>
                      <InterestButton item={item} subscribed disabled={pending || confirming} />
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">등록된 관심 항목이 없습니다.</p>
          )}
        </ListView>
        {/* 선택 항목의 건수를 알리고 삭제와 취소를 구분한다. */}
        <AlertDialogContent>
          <AlertDialogTitle>선택한 관심 항목 삭제</AlertDialogTitle>
          <AlertDialogDescription>선택한 관심 항목 {targets.length}건을 제거하시겠습니까?</AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild><Button variant="outline" disabled={pending}>취소</Button></AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={pending || !targets.length} onClick={confirmRemoval}>
              {pending ? "삭제 중" : "삭제"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

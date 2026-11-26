"use client";

import { useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import type { InterestKey } from "@/shared/model/g2b/interest";
import { setInterest } from "./actions";

/**
 * 현재 관심 상태를 별에 표시하고 사용자 선택을 서버에 적용한다.
 * @param props.item 상세와 목록에서 공유하는 업무 키.
 * @param props.subscribed 서버에서 조회한 관심 상태.
 * @param props.disabled 일괄 변경 중일 때 개별 입력을 막는 상태.
 * @returns 접근 가능한 관심 등록·해제 버튼.
 */
export function InterestButton({ item, subscribed, disabled }: {
  item: InterestKey;
  subscribed: boolean;
  disabled?: boolean;
}) {
  // 서버에서 최신 상태를 다시 렌더링하는 동안 같은 버튼의 중복 작업을 막는다.
  const [pending, startTransition] = useTransition();
  // 아이콘 모양과 함께 접근성 이름으로 클릭 결과를 안내한다.
  const label = subscribed ? "관심 제거" : "관심 등록";

  /** 현재 별의 반대 상태를 요청하고 실제 결과를 토스트로 알린다. */
  function changeInterest() {
    // 서버가 변경 후 화면을 갱신할 때까지 처리 상태를 유지한다.
    startTransition(async () => {
      try {
        // React 속성이 붙은 목록 행에서도 업무 키 세 필드만 서버에 보낸다.
        const { type, number, revision } = item;
        const result = await setInterest({ type, number, revision }, !subscribed);
        // 실패하면 갱신된 상태를 표시하지 않고 서버의 안내를 표시한다.
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        // 서버가 확정한 등록 상태에 맞춰 성공을 알린다.
        toast.success(result.subscribed ? "관심 목록에 추가되었습니다." : "관심 목록에서 제거되었습니다.");
      } catch {
        // 통신 자체가 실패한 경우 기존 상태에서 다시 시도할 수 있다.
        toast.error("관심 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  // 빈 별과 채운 별로 상태를 구분하고 처리 중에는 버튼을 비활성화한다.
  return (
    <Button type="button" variant="outline" size="icon" title={label} aria-label={label}
      aria-pressed={subscribed} disabled={pending || disabled} onClick={changeInterest} className="shrink-0">
      <Star aria-hidden="true" className={subscribed ? "fill-current text-amber-600" : undefined} />
    </Button>
  );
}

"use client";

import { useActionState } from "react";
import { registerMyBusiness, retryMyBusiness } from "@/features/business-information/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/**
 * 사업자 등록 또는 선택 사업자의 재시도 폼을 렌더링한다.
 * @param props 사업자 ID가 있으면 해당 사업자의 재시도 폼을 표시한다.
 * @returns 현재 요청의 처리 상태를 안내하는 폼.
 */
export function BusinessForm({ businessId }: { businessId?: number }) {
  // 사업자 ID의 유무로 폼의 동작을 정하고 중복 제출을 제어한다.
  const retry = businessId !== undefined;
  const [message, action, pending] = useActionState(retry ? retryMyBusiness : registerMyBusiness, "");

  // 등록 입력 또는 상세 재시도 버튼과 처리 상태를 같은 폼에 배치한다.
  return (
    <form action={action} className="grid gap-2">
      {retry ? (
        // 상세에서 선택한 내부 ID를 보내며 서버에서 등록 관계를 다시 확인한다.
        <input type="hidden" name="businessId" value={businessId} />
      ) : (
        // 형식 가이드를 보여주고 최종 검증은 서버에서 수행한다.
        <label className="grid gap-2 text-sm font-medium">
          사업자등록번호
          <Input name="number" inputMode="numeric" required placeholder="000-00-00000" />
        </label>
      )}
      {/* 네트워크 처리 중에는 같은 등록 또는 재시도를 다시 제출하지 않는다. */}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "처리 중…" : retry ? "미완료 수집 재시도" : "사업자 등록"}
      </Button>
      {/* 서버가 반환한 결과를 보조 기술에도 알린다. */}
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
    </form>
  );
}

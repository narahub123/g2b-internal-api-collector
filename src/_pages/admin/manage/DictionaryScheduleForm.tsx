"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
/** 자동 확인 폼에서 편집하는 설정값이다. */
type ScheduleSettings = {
  /** 자동 확인 사용 여부. */
  enabled: boolean;
  /** 양의 정수로 입력하는 확인 주기. */
  days: number;
};

/**
 * 초기 설정을 편집하고 전달받은 저장 함수로 제출한 결과를 표시한다.
 * @param props.settings 적용된 설정값.
 * @param props.onSave 설정을 저장하고 실패 시 표시할 문구를 반환하는 함수.
 * @returns 자동 확인 활성화와 주기 입력 폼.
 */
export function DictionaryScheduleForm({ settings, onSave }: {
  /** 폼 편집을 시작할 설정값. */
  settings: ScheduleSettings;
  /** 호출 화면이 제공하는 저장 동작. */
  onSave: (settings: ScheduleSettings) => Promise<{ error?: string }>;
}) {
  // 체크박스와 숫자 입력에 접근 가능한 이름을 연결한다.
  const id = useId();
  // 저장 전까지 활성 여부와 주기를 폼에 보관한다.
  const [enabled, setEnabled] = useState(settings.enabled);
  const [days, setDays] = useState(String(settings.days));
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const running = useRef(false);

  /**
   * 클릭과 Enter 제출이 공유하는 경로에서 같은 요청의 재진입을 차단한다.
   * @param event 자동 확인 폼 제출 이벤트.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setMessage("");
    startTransition(async () => {
      try {
        // 입력값을 설정 형식으로 변환해 화면에서 연결한 저장 동작에 전달한다.
        const result = await onSave({ enabled, days: Number(days) });
        setMessage(result.error ?? "자동 수집 설정을 저장했습니다.");
      } catch {
        setMessage("자동 수집 설정을 저장하지 못했습니다.");
      } finally {
        running.current = false;
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t pt-3 text-sm">
      {/* 자동 수집을 사용하지 않아도 다음에 사용할 주기를 저장할 수 있다. */}
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={enabled} disabled={pending} onCheckedChange={(value) => setEnabled(value === true)} />
        <label htmlFor={id}>자동 수집 활성화</label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id + "-days"}>확인 주기(일)</label>
        <Input id={id + "-days"} type="number" min={1} step={1} required value={days} disabled={pending}
          onChange={(event) => setDays(event.target.value)} className="w-24" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? "저장 중" : "저장"}</Button>
      </div>
      <p role="status" className="text-muted-foreground empty:hidden">{message}</p>
    </form>
  );
}

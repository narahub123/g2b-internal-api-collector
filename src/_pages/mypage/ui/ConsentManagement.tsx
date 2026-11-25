"use client";

import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ConsentField } from "@/features/service-auth/AuthForm";
import { refreshConsentSession, submitConsentChange } from "@/features/service-auth/consent-actions";
import { withSessionCookieWrite } from "@/features/service-auth/session-writes";
import type { ManagedConsent } from "@/server/auth/consent-management";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from "@/shared/ui/alert-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";

/** 동의 요청과 세션 복구가 사용자에게 안내할 처리 결과. */
type ConsentResult = Awaited<ReturnType<typeof submitConsentChange>>;
/** Dialog가 저장 결과를 상위 카드에 전달하는 제출 함수. */
type SubmitConsent = (data: FormData) => Promise<void>;

/** 정책과 날짜 표시에 사용하는 서비스 시간대. */
const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });
/** 공개할 수 있는 처리 결과와 사용자 안내. */
const messages: Record<ConsentResult, string> = {
  saved: "동의 상태를 반영했습니다.",
  "session-pending": "동의 이력은 저장됐습니다. 세션 상태를 다시 확인해 주세요.",
  stale: "문서가 변경됐습니다. 최신 문서를 다시 확인해 주세요.",
  invalid: "이 동의 작업을 진행할 수 없습니다. 현재 상태를 확인해 주세요.",
  "signed-out": "로그인 후 다시 시도해 주세요.",
  failed: "동의 상태를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

/**
 * 확인을 완료했을 때만 동의 또는 철회를 제출하도록 폼의 상태를 표시한다.
 * @param props 제출 버튼 문구, 비활성 조건과 철회 스타일.
 * @returns 해당 Dialog의 제출 버튼.
 */
function ConsentSubmitButton({ label, disabled = false, withdrawal = false }: { label: string; disabled?: boolean; withdrawal?: boolean }) {
  // 상위 폼 처리 중에는 중복 제출을 막는다.
  const { pending } = useFormStatus();
  return <Button type="submit" variant={withdrawal ? "destructive" : "default"} disabled={disabled || pending}>
    {pending ? "처리 중…" : label}
  </Button>;
}

/**
 * 신규 동의나 재동의에 필요한 현재 문서만 Dialog에서 확인하게 한다.
 * @param props 현재 표시 문서와 서버 제출 callback.
 * @returns 내용 확인과 체크 제출을 제공하는 Dialog.
 */
function AgreementDialog({ item, submit }: { item: ManagedConsent & { content: string }; submit: SubmitConsent }) {
  // 닫고 다시 열면 이전 체크를 이어서 제출하지 않는다.
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const label = item.renewal ? "재동의" : "동의하기";
  /**
   * Dialog가 열릴 때 문서를 새로 확인하도록 체크를 초기화한다.
   * @param next 열거나 닫을 상태.
   */
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) setChecked(false);
  }
  /**
   * 사용자가 확인한 버전의 동의를 저장 요청하고 결과는 카드에 표시한다.
   * @param form 항목과 버전 및 체크 상태가 들어 있는 폼.
   */
  async function save(form: FormData) {
    await submit(form);
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" size="sm" variant="outline">{label}</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle className="font-semibold">{item.title}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">문서를 확인한 후 동의해 주세요.</DialogDescription>
        <form action={save} className="grid gap-4">
          {/* 문서 버전과 체크는 가입에서도 쓰는 공통 입력에서 제출한다. */}
          <input type="hidden" name="item" value={item.id} />
          <input type="hidden" name="operation" value="agree" />
          <ConsentField item={item} required={item.required} checked={checked} onChange={setChecked} />
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline">취소</Button></DialogClose>
            <ConsentSubmitButton label={label} disabled={!checked} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 선택 항목의 철회를 확인한 뒤 현재 문서에 대한 철회 요청을 보낸다.
 * @param props 철회할 선택 항목과 제출 callback.
 * @returns 기존 공통 확인 Dialog를 사용한 철회 입력.
 */
function WithdrawalDialog({ item, submit }: { item: ManagedConsent; submit: SubmitConsent }) {
  // 확인을 마친 요청만 제출하고 결과는 카드에 표시한다.
  const [open, setOpen] = useState(false);
  /**
   * 확인을 마친 선택 동의 철회를 저장 요청한다.
   * @param form 철회할 문서 ID와 현재 버전.
   */
  async function save(form: FormData) {
    await submit(form);
    setOpen(false);
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild><Button type="button" size="sm" variant="outline">동의 철회</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle className="font-semibold">선택 동의 철회</AlertDialogTitle>
        <AlertDialogDescription className="text-sm text-muted-foreground">{item.title} 동의를 철회하시겠습니까?</AlertDialogDescription>
        <form action={save} className="flex flex-wrap justify-end gap-2">
          {/* 서버가 현재 버전을 검증할 때 사용할 문서 정보를 전달한다. */}
          <input type="hidden" name="item" value={item.id} />
          <input type="hidden" name="operation" value="withdraw" />
          <input type="hidden" name={`version:${item.id}`} value={item.version} />
          <AlertDialogCancel asChild><Button type="button" variant="outline">취소</Button></AlertDialogCancel>
          <ConsentSubmitButton label="동의 철회" withdrawal />
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 정책별 최신 동의와 날짜를 표시하고 필요한 변경 동작을 제공한다.
 * @param props 현재 시행 중인 문서 및 계정에 적용된 동의 목록.
 * @returns PC와 모바일이 공유하는 동의 관리 카드.
 */
export function ConsentManagement({ items, sessionOutOfSync }: {
  // 화면에 표시할 정책별 최신 동의.
  items: ManagedConsent[];
  // 같은 이력으로 계산한 상태와 로그인 쿠키의 재동의 상태가 다른지 여부.
  sessionOutOfSync: boolean;
}) {
  // 결과 안내를 카드에 유지하면서 표시 데이터만 서버에서 다시 읽는다.
  const router = useRouter();
  const [result, setResult] = useState<ConsentResult | null>(null);
  const [retrying, startRetry] = useTransition();

  /**
   * 세션 쿠키를 쓰는 기존 요청과 순서를 맞춰 동의를 제출한다.
   * @param data 사용자가 확인한 동의 또는 철회 폼.
   */
  async function submit(data: FormData) {
    try {
      // 로그아웃·세션 갱신과 경쟁하지 않도록 공통 잠금을 사용한다.
      const saved = await withSessionCookieWrite(() => submitConsentChange(data));
      setResult(saved);
      if (saved === "signed-out") router.replace("/login");
      else if (saved === "saved" || saved === "stale" || saved === "session-pending") router.refresh();
    } catch {
      // 통신 오류에서는 저장 성공 여부를 단정하지 않는다.
      setResult("failed");
    }
  }

  /** 동의 이력을 다시 쓰지 않고 세션 재동의 상태만 복구한다. */
  function retrySession() {
    /** 쿠키 쓰기를 직렬화하고 재시도 버튼의 진행 상태를 유지한다. */
    startRetry(async () => {
      try {
        const refreshed = await withSessionCookieWrite(refreshConsentSession);
        setResult(refreshed);
        if (refreshed === "signed-out") router.replace("/login");
        else if (refreshed === "saved") router.refresh();
      } catch {
        // 세션을 확인하지 못했으므로 재시도 동작을 유지한다.
        setResult("session-pending");
      }
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>동의 관리</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {/* 저장과 세션 복구 결과는 화면 이동 없이 카드에서 안내한다. */}
        {result && <p role="status" className="text-sm">{messages[result]}</p>}
        {(result === "session-pending" || sessionOutOfSync) && (
          <Button type="button" size="sm" variant="outline"
            className="justify-self-start" onClick={retrySession} disabled={retrying}>세션 다시 확인</Button>
        )}
        {!items.length && <p className="text-sm text-muted-foreground">현재 시행 중인 동의 항목이 없습니다.</p>}
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="grid min-w-0 gap-1">
                {/* 문서의 필수·선택, 동의 상태와 재동의 여부를 함께 표시한다. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{item.title}</span>
                  <Badge variant="secondary">{item.required ? "필수" : "선택"}</Badge>
                  <Badge variant="outline">{item.agreed ? "동의" : "미동의"}</Badge>
                  {item.renewal && <Badge variant="secondary">재동의 필요</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">동의 일자 {item.agreedAt === null ? "—" : dateFormat.format(item.agreedAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* 동의나 재동의 가능한 원문만 열고 선택 동의의 철회를 제공한다. */}
                {item.content !== null && <AgreementDialog key={`agree-${item.version}`} item={{ ...item, content: item.content }} submit={submit} />}
                {!item.required && item.agreed && <WithdrawalDialog key={`withdraw-${item.version}`} item={item} submit={submit} />}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

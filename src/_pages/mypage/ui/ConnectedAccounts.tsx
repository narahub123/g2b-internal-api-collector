"use client";

import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { beginAccountOAuth, unlinkOAuthAccount } from "@/features/service-auth/actions";
import { OAUTH_PROVIDERS } from "@/shared/config/oauth-providers";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from "@/shared/ui/alert-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

/** 화면에서 표시하고 확인 Dialog에서 사용할 연결 정보. */
export type ConnectedAccount = {
  /** 공급자의 표시 이름을 조회할 식별자. */
  provider: string;
  /** OAuth로 확인한 이메일 또는 아직 확인되지 않은 상태. */
  email: string | null;
  /** 해제 요청에서 기존 연결과 재연결된 계정을 구분할 값. */
  generation: string;
  /** 현재 로그인에 사용한 계정인지 나타낸다. */
  current: boolean;
};

/** 처리 결과 코드에 대응하는 공개 메시지. */
const notices = new Map([
  ["added", "계정을 연결했습니다."],
  ["already-linked", "이미 연결된 계정입니다."],
  ["conflict", "다른 사용자에게 연결된 계정입니다."],
  ["expired", "계정 추가 요청이 만료됐거나 로그인 계정이 변경됐습니다. 다시 시작해 주세요."],
  ["cancelled", "계정 추가를 취소했습니다."],
  ["failed", "계정 작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."],
  ["unlinked", "계정 연결을 해제했습니다."],
  ["unlink-blocked", "계정을 해제할 수 없습니다. 현재 연결 상태를 확인해 주세요."],
]);

/**
 * 등록된 공급자의 화면 표시 이름을 반환한다.
 * @param provider 서버가 조회한 OAuth 공급자 식별자.
 * @returns 공급자 설정의 이름 또는 저장된 이름.
 */
function providerLabel(provider: string) {
  // 기존 연결의 공급자 표시도 공급자 목록을 기준으로 맞춘다.
  return OAUTH_PROVIDERS.find(({ id }) => id === provider)?.label ?? provider;
}

/**
 * 작업 전후 버튼 안내를 바꾸고 중복 제출을 막는다.
 * @param props 대화상자의 버튼 문구와 위험 작업 여부.
 * @returns 연결 또는 해제를 실행하는 제출 버튼.
 */
function SubmitAccountButton({ unlink = false }: { unlink?: boolean }) {
  // 상위 폼의 서버 액션이 끝날 때까지 같은 요청을 다시 보내지 않는다.
  const { pending } = useFormStatus();
  return <Button type="submit" variant={unlink ? "destructive" : "default"} disabled={pending}>
    {pending ? "처리 중…" : unlink ? "연결 해제" : "OAuth 인증 계속"}
  </Button>;
}

/**
 * 공급자만 선택하는 계정 추가 대화상자를 제공한다.
 * @returns 사용자 확인 후 기존 공급자 인증으로 이동하는 폼.
 */
function AddAccountDialog() {
  return (
    <Dialog>
      {/* 독립 대화상자에서 공급자를 고른 뒤 OAuth 인증을 시작한다. */}
      <DialogTrigger asChild><Button type="button" variant="outline">계정 추가</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle className="font-semibold">계정 추가</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">연결할 공급자를 선택하고 해당 계정으로 인증해 주세요.</DialogDescription>
        <form action={beginAccountOAuth} className="grid gap-4">
          {/* 이메일은 공급자 인증에서 확인하므로 공급자 이름만 제출한다. */}
          <Select name="provider" defaultValue={OAUTH_PROVIDERS[0].id} required>
            <SelectTrigger aria-label="OAuth 공급자"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OAUTH_PROVIDERS.map(({ id, label }) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline">취소</Button></DialogClose>
            <SubmitAccountButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 선택한 연결의 공급자와 이메일을 확인하고 해제를 요청한다.
 * @param props.account 현재 로그인에 사용하지 않는 해제 대상 계정.
 * @returns 연결을 해제하기 전에 확인을 받는 대화상자.
 */
function UnlinkAccountDialog({ account }: { account: ConnectedAccount }) {
  // 선택한 공급자와 이메일을 사용자가 구별할 수 있는 한 문구로 표시한다.
  const description = `${providerLabel(account.provider)} · ${account.email ?? "이메일 미확인"}`;
  return (
    <AlertDialog>
      {/* 해제 대상이 확인될 때만 서버 액션을 제출할 수 있다. */}
      <AlertDialogTrigger asChild><Button type="button" size="sm" variant="outline">연결 해제</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle className="font-semibold">계정 연결 해제</AlertDialogTitle>
        <AlertDialogDescription className="break-all text-sm text-muted-foreground">
          {description} 연결을 해제하면 이 계정으로 로그인한 다른 기기에서도 다시 로그인해야 합니다.
        </AlertDialogDescription>
        <form action={unlinkOAuthAccount} className="flex flex-wrap justify-end gap-2">
          {/* 서버에서 현재 연결을 재검증할 수 있도록 대상 세대만 제출한다. */}
          <input type="hidden" name="generation" value={account.generation} />
          <AlertDialogCancel asChild><Button type="button" variant="outline">취소</Button></AlertDialogCancel>
          <SubmitAccountButton unlink />
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 연결된 계정과 현재 로그인 표시, 연결 변경 동작을 한 카드에 제공한다.
 * @param props.accounts 현재 사용자의 서버 검증 연결 목록.
 * @returns PC와 모바일이 공유하는 연결 계정 화면.
 */
export function ConnectedAccounts({ accounts }: { accounts: ConnectedAccount[] }) {
  // 이동 결과는 서버에서 발급한 허용 코드에 해당하는 문구로만 표시한다.
  const search = useSearchParams();
  const notice = notices.get(search.get("account") ?? "");
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>연결된 계정</CardTitle>
        <AddAccountDialog />
      </CardHeader>
      <CardContent className="grid gap-3">
        {/* 완료·실패 원인을 보조 기술에도 전달한다. */}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <ul className="divide-y">
          {accounts.map((account) => (
            <li key={account.generation} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                {/* 현재 로그인 계정도 다른 연결과 같은 공급자 및 이메일 정보를 표시한다. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{providerLabel(account.provider)}</span>
                  {account.current && <Badge variant="secondary">현재 로그인</Badge>}
                </div>
                <p className="break-all text-sm text-muted-foreground">{account.email ?? "이메일 미확인"}</p>
              </div>
              {/* 현재 로그인 계정 또는 마지막 연결에는 해제 동작을 제공하지 않는다. */}
              {!account.current && accounts.length > 1 && <UnlinkAccountDialog account={account} />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

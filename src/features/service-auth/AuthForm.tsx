"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import type { ConsentPolicy } from "@/shared/config/auth";
import { beginOAuth } from "./actions";

// 체크 UI에 필요한 항목 ID, 문서 버전과 내용, 필수 속성만 폼에 전달한다.
type ConsentItem = Pick<ConsentPolicy, "id" | "version" | "content" | "required">;
// 가입과 로그인에서 다르게 표시할 폼의 목적이다.
type Purpose = "login" | "signup";

/**
 * 가입과 로그인에서 같은 공급자 버튼을 사용하며 제출 중 재요청을 막는다.
 * @param props 버튼의 목적, 제공자 표시와 비활성 조건.
 * @param props.purpose 가입과 로그인 중 버튼 문구를 정하는 목적.
 * @param props.provider 버튼에 표시할 OAuth 제공자 명칭.
 * @param props.disabled 필수 동의 누락 등으로 버튼을 비활성화할지 여부.
 * @returns 상태에 맞는 안내와 비활성 조건을 포함한 OAuth 버튼.
 */
function OAuthButton({ purpose, provider, disabled }: { purpose: Purpose; provider: string; disabled: boolean }) {
  // 상위 폼의 서버 액션 제출 상태를 읽는다.
  const { pending } = useFormStatus();
  // 동의가 충족되지 않거나 공급자로 이동 중일 때 추가 제출을 막는다.
  return (
    <Button type="submit" disabled={disabled || pending} className="w-full">
      {/* 제출 중에는 진행 안내를 표시하고 평소에는 제공자와 인증 목적을 표시한다. */}
      {pending ? "Google 인증 화면으로 이동 중…" : `${provider}로 ${purpose === "signup" ? "가입" : "로그인"}`}
    </Button>
  );
}

/**
 * 전체 동의 표시 설정과 개별 항목의 선택·부분 선택 상태를 반영한다.
 * @param props 전체 동의 표시와 선택 상태를 연결할 속성.
 * @param props.enabled 전체 동의 UI 제공 여부.
 * @param props.checked 전체 선택, 전체 해제 또는 일부 선택 상태.
 * @param props.onChange 사용자 선택을 전체 항목에 반영하는 콜백.
 * @returns 전체 동의 체크박스 또는 비활성 설정이면 null.
 */
function AllConsents({ enabled, checked, onChange }: {
  // 전체 동의 설정이 켜져 있는지 나타낸다.
  enabled: boolean;
  // 부분 선택이면 체크박스를 혼합 상태로 표시한다.
  checked: boolean | "indeterminate";
  // 선택 또는 해제를 모든 항목에 적용한다.
  onChange: (checked: boolean) => void;
}) {
  // 설정에서 전체 동의를 끄면 컨트롤을 렌더링하지 않는다.
  if (!enabled) return null;
  // 개별 상태를 반영하는 전체 동의 조작을 표시한다.
  return (
    <label className="flex items-center gap-3 rounded-md border p-3 font-medium">
      {/* 체크 상태가 변경되면 전체 항목의 선택 상태를 갱신한다. */}
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      전체 동의
    </label>
  );
}

/**
 * 항목별 내용을 표시하고 제출에 해당 버전과 필수 여부를 반영한다.
 * @param props 동의 문서와 현재 선택을 연결할 속성.
 * @param props.item 표시할 동의 내용과 제출에 필요한 식별자·버전.
 * @param props.required 이 항목이 가입에 필요한지 여부.
 * @param props.checked 현재 체크 여부.
 * @param props.onChange 해당 항목의 체크 변경 콜백.
 * @returns 문서 버전과 동의 결과를 제출하는 표시 항목.
 */
function ConsentField({ item, required, checked, onChange }: {
  // 현재 동의 대상 문서의 설정.
  item: ConsentItem;
  // 제출과 화면 안내에 반영할 필수 여부.
  required: boolean;
  // 사용자가 해당 항목을 선택했는지 나타낸다.
  checked: boolean;
  // 체크 변경을 폼의 선택 상태에 반영한다.
  onChange: (checked: boolean) => void;
}) {
  // 문서 내용과 그 문서에 대한 체크 상태를 함께 표시한다.
  return (
    <div className="grid gap-2 rounded-md border p-3">
      {/* 사용자가 본 문서 버전을 서버에서 확인할 수 있게 전달한다. */}
      <input type="hidden" name={`version:${item.id}`} value={item.version} />
      {/* 라벨로 묶어 문구 선택으로도 체크를 변경할 수 있게 한다. */}
      <label className="flex items-center gap-3">
        <Checkbox name={`consent:${item.id}`} required={required} checked={checked}
          onCheckedChange={(value) => onChange(value === true)} />
        {/* 항목 내용 앞에 필수 또는 선택 표시를 제공한다. */}
        <span>{required ? "필수 동의" : "선택 동의"} · {item.content}</span>
      </label>
    </div>
  );
}

/**
 * 가입에서는 동의 선택을 복원하고 모든 필수 항목에 동의하면 OAuth 버튼을 활성화한다.
 * 로그인에서는 동의 항목 없이 공급자 버튼만 표시한다.
 * @param props 인증 화면의 목적과 동의 폼에 필요한 상태.
 * @param props.purpose 동의 항목을 표시할지 결정하는 인증 목적.
 * @param props.items 가입 화면에 표시할 현재 문서 목록.
 * @param props.initialChecked 이전 OAuth 요청에서 복원할 체크 항목 ID.
 * @param props.allConsentsEnabled 전체 동의 컨트롤 표시 여부.
 * @returns 로그인 또는 가입을 시작하는 공통 제출 폼.
 */
export function AuthForm({ purpose, items = [], initialChecked = [], allConsentsEnabled = false }: {
  // 가입 또는 로그인 목적을 서버 액션에 전달한다.
  purpose: Purpose;
  // 가입에서 제출할 현재 동의 항목 목록.
  items?: readonly ConsentItem[];
  // OAuth 복귀 후 처음 선택된 항목의 식별자 목록.
  initialChecked?: readonly string[];
  // 전체 동의 기능을 화면에 제공할지 여부.
  allConsentsEnabled?: boolean;
}) {
  // 복원한 항목을 초기 선택에 반영하고 이후 브라우저에서 갱신한다.
  const [checked, setChecked] = useState(() => new Set(initialChecked));
  // 선택할 항목이 있고 모두 체크되었는지 판정한다.
  const everyChecked = items.length > 0 && items.every(({ id }) => checked.has(id));
  // 일부 선택을 전체 동의 화면의 부분 상태로 표시할지 판정한다.
  const someChecked = items.some(({ id }) => checked.has(id));
  // 인증 목적과 항목별 선택을 서버 액션에 제출하는 폼을 반환한다.
  return (
    <form action={beginOAuth} className="grid gap-4">
      {/* 브라우저의 폼 제출에서 인증 목적을 유지한다. */}
      <input type="hidden" name="purpose" value={purpose} />
      {/* 가입에만 동의 목록을 보여 주고 로그인에서는 버튼만 제공한다. */}
      {purpose === "signup" && (
        <fieldset className="grid gap-3">
          {/* 스크린리더에 여러 체크박스가 법적 동의 그룹임을 알린다. */}
          <legend className="mb-3 text-sm font-medium">법적 동의</legend>
          {/* 활성 설정과 항목 유무를 확인해 전체 동의를 제공한다. */}
          <AllConsents enabled={allConsentsEnabled && items.length > 0}
            checked={everyChecked || (someChecked ? "indeterminate" : false)}
            onChange={(value) => setChecked(new Set(value ? items.map(({ id }) => id) : []))} />
          {/* 각 문서의 버전과 상태를 독립적으로 제출하는 항목을 만든다. */}
          {items.map((item) => (
            <ConsentField key={item.id} item={item} required={item.required} checked={checked.has(item.id)}
              onChange={(value) => setChecked((previous) => {
                // 기존 선택을 복사해 다른 항목의 상태와 이전 렌더링을 보존한다.
                const next = new Set(previous);
                // 체크한 항목 ID를 현재 선택에 추가한다.
                if (value) next.add(item.id);
                // 체크를 해제한 항목 ID만 현재 선택에서 뺀다.
                else next.delete(item.id);
                // 변경한 선택 집합으로 폼의 표시 상태를 갱신한다.
                return next;
              })} />
          ))}
        </fieldset>
      )}
      {/* 미체크 필수 항목이 남아 있으면 공급자 버튼을 비활성화한다. */}
      <OAuthButton purpose={purpose} provider="Google" disabled={items.some(({ id, required }) => required && !checked.has(id))} />
    </form>
  );
}

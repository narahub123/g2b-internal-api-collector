"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/shared/ui/button";
import { chooseOAuthAccount } from "./actions";

/** 선택 화면에 공개되는 흐름별 후보 값과 최소 표시 이름. */
type LinkChoice = { selection: string; label: string };

/**
 * 대상별 버튼과 별도 생성 버튼을 표시하고 요청 중에는 중복 선택을 막는다.
 * @param props.candidates 현재 선택 요청에만 유효한 후보 선택 값과 라벨.
 * @returns OAuth 추가 인증 또는 별도 가입을 요청하는 버튼 목록.
 */
function ChoiceButtons({ candidates }: { candidates: readonly LinkChoice[] }) {
  // 한 버튼을 제출하면 해당 폼의 모든 선택을 잠근다.
  const { pending } = useFormStatus();
  return (
    <>
      {/* 기존 계정 선택은 저장된 연결에 대한 추가 OAuth 인증으로 이어진다. */}
      {candidates.map(({ selection, label }) => (
        <Button key={selection} type="submit" name="choice" value={selection} disabled={pending} variant="outline">
          {label} 인증하기
        </Button>
      ))}
      {/* 사용자는 같은 이메일이어도 별개의 내부 계정을 만들 수 있다. */}
      <Button type="submit" name="choice" value="separate" disabled={pending}>별도 계정 만들기</Button>
      {/* 공급자로 이동하거나 저장을 마칠 때까지 처리 상태를 안내한다. */}
      {pending && <p role="status" className="text-sm">선택한 요청을 처리하는 중입니다…</p>}
    </>
  );
}

/**
 * 검증된 최초 가입 흐름에 후보 선택값을 연결해 서버 액션에 제출한다.
 * @param props.state 해당 탭의 최초 가입 요청을 구분하는 키.
 * @param props.candidates 내부 사용자 ID를 제거한 표시 후보.
 * @returns 계정 선택과 별도 가입을 제공하는 폼.
 */
export function LinkAccountForm({ state, candidates }: { state: string; candidates: readonly LinkChoice[] }) {
  return (
    <form action={chooseOAuthAccount} className="grid gap-3">
      {/* 처음 검증한 OAuth 프로필과 해당 흐름의 후보를 서버에서 다시 확인한다. */}
      <input type="hidden" name="flow" value={state} />
      <ChoiceButtons candidates={candidates} />
    </form>
  );
}

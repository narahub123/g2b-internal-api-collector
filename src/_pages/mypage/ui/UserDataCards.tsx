"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { AUTH_ERROR_PATH, AUTH_RETURN_PATH } from "@/shared/config/page-access";
import { Button } from "@/shared/ui/button";
import type { ConsentRenewal } from "@/server/auth/types";
import { MyPageUserDataError, myPageUserDataOptions } from "@/features/service-auth/mypage-user-data-query";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { ConsentManagement } from "./ConsentManagement";

/**
 * 연결 변경 결과를 탐색마다 확인하고 현재 로그인 연결의 업무 카드를 표시한다.
 * @param props.scope 서버에서 확인한 사용자 및 로그인 연결 범위.
 * @param props.sessionRenewal 현재 쿠키가 가진 재동의 요약.
 * @returns 캐시 정책이 적용된 사용자 정보 카드.
 */
export function UserDataCards({ scope, sessionRenewal }: { scope: string; sessionRenewal: ConsentRenewal }) {
  // 기존 리디렉션의 성공 코드와 반복 해제를 구별하는 값으로 갱신을 한 번 적용한다.
  const search = useSearchParams();
  const account = search.get("account");
  const result = account === "added" || account === "unlinked"
    ? account + ":" + (search.get("accountChange") ?? "") : null;
  // 다른 결과나 로그인 연결이 표시되면 별도의 조회 상태를 사용한다.
  return <UserDataQuery key={scope + ":" + result} scope={scope} sessionRenewal={sessionRenewal} accountChanged={result !== null} />;
}

/**
 * 인증된 연결 범위의 업무 데이터를 조회하고 변경 후 최신 상태를 반영한다.
 * @param props.scope 현재 로그인 연결의 캐시 범위.
 * @param props.sessionRenewal 현재 세션의 재동의 상태.
 * @param props.accountChanged 성공한 계정 연결 변경 화면인지 여부.
 * @returns 연결 목록과 동의 카드 또는 조회 상태 안내.
 */
function UserDataQuery({ scope, sessionRenewal, accountChanged }: {
  scope: string; sessionRenewal: ConsentRenewal; accountChanged: boolean;
}) {
  // 루트 Provider의 캐시를 쓰며 성공 복귀에서는 기존 결과를 먼저 무효화한다.
  const client = useQueryClient();
  const options = myPageUserDataOptions(scope);
  const [ready, setReady] = useState(!accountChanged);
  const handled = useRef(false);
  /** 변경 성공으로 처음 표시된 화면에서는 오래된 데이터를 가리고 요청을 한 번만 시작한다. */
  useEffect(() => {
    // 개발 모드의 효과 재실행에도 같은 복귀 결과는 한 번만 처리한다.
    if (!accountChanged || handled.current) return;
    handled.current = true;
    // 변경 전에 시작된 요청을 취소하고 다음 자동 조회로 최신 상태를 읽는다.
    void client.cancelQueries({ queryKey: myPageUserDataOptions(scope).queryKey });
    void client.invalidateQueries({ queryKey: myPageUserDataOptions(scope).queryKey, refetchType: "none" });
    setReady(true);
  }, [accountChanged, client, scope]);
  // 평범한 메뉴 재방문에는 기존 데이터를 30초 동안 재사용한다.
  const query = useQuery({ ...options, enabled: ready });
  // 다른 계정의 쿠키나 인증 거절이 관측되면 보관된 업무 데이터부터 숨긴다.
  const status = query.error instanceof MyPageUserDataError ? query.error.status : 0;
  const denied = status === 401 || status === 403 || status === 409 || status === 503;
  /** 접근을 다시 확인해야 할 때 해당 계정의 캐시를 지우고 서버 화면으로 이동한다. */
  useEffect(() => {
    // 일반 조회 실패는 현재 화면에서 재시도할 수 있다.
    if (!denied) return;
    // 인증 이동이 시작되기 전에 이 연결에 저장된 데이터를 삭제한다.
    client.removeQueries({ queryKey: myPageUserDataOptions(scope).queryKey });
    // 기존 접근 거절 경로 또는 새 계정의 서버 화면으로 이동한다.
    const destinations = {
      401: "/login",
      403: AUTH_RETURN_PATH + "?" + new URLSearchParams({ from: window.location.pathname }),
      409: window.location.href,
      503: AUTH_ERROR_PATH,
    };
    window.location.replace(destinations[status]);
  }, [client, denied, scope, status]);

  /** 변경된 동의 이력을 최신 업무 데이터로 다시 읽는다. */
  function refreshUserData() {
    void client.invalidateQueries({ queryKey: options.queryKey });
  }

  // 연결 변경 또는 인증 이동이 끝나기까지 이전 업무 카드를 표시하지 않는다.
  if (!ready || denied || query.isPending || (accountChanged && query.isFetching)) {
    return <p role="status">사용자 정보를 불러오는 중입니다.</p>;
  }
  // 통신 오류는 로그인이나 세션 정책을 변경하지 않고 요청을 다시 할 수 있게 한다.
  if (query.isError) return <div role="alert">
    <p>사용자 정보를 불러오지 못했습니다.</p>
    <Button type="button" variant="outline" onClick={() => void query.refetch()}>다시 시도</Button>
  </div>;

  // 현재 세션의 상태와 업무 쿼리에서 계산한 요약을 비교한다.
  const { accounts, consents } = query.data;
  return (
    <>
      <ConnectedAccounts accounts={accounts} />
      <ConsentManagement items={consents.items} onDataChanged={refreshUserData} sessionOutOfSync={
        sessionRenewal.required !== consents.renewal.required || sessionRenewal.overdue !== consents.renewal.overdue
      } />
    </>
  );
}

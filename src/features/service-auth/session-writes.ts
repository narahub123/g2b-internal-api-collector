"use client";

/** 같은 브라우저에서 갱신과 로그아웃이 같은 쿠키를 동시에 쓰지 않도록 사용하는 잠금 이름. */
const sessionWriteLock = "g2b-service-session-cookie";

// Web Locks를 사용할 수 없는 브라우저에서는 같은 탭 안에서라도 쿠키 쓰기 순서를 보장한다.
let queuedWrite: Promise<unknown> = Promise.resolve();

/**
 * 앞선 갱신 응답보다 나중에 로그아웃 응답을 적용할 수 있도록 쿠키 쓰기를 직렬화한다.
 * @param write 응답 쿠키를 바꾸는 비동기 호출.
 * @returns 지정된 호출의 정상 결과.
 * @throws 요청 처리 오류를 호출자에게 전달하며 다음 쿠키 쓰기는 계속할 수 있다.
 */
export function withSessionCookieWrite<T>(write: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(sessionWriteLock, write);
  const current = queuedWrite.then(write);
  // 실패한 작업 이후의 로그아웃이나 갱신도 계속할 수 있게 한다.
  queuedWrite = current.catch(() => undefined);
  return current;
}

import { CookieJar } from 'tough-cookie';
import { readG2bResponse } from './g2b-maintenance';

const homepage = new URL('https://www.g2b.go.kr/');
// 익명 쿠키를 얻는 동안 명시적인 HTTP 리다이렉트만 같은 출처에서 따라간다.
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/**
 * 나라장터 홈페이지에서 익명 쿠키를 발급받아 이 세션의 서버 요청에 재사용한다.
 * @returns 나라장터 동일 출처에만 쿠키를 보내고 이후 응답의 쿠키 갱신도 반영하는 요청 함수.
 * @throws 홈페이지 응답이 점검 화면이거나, 쿠키를 확보하지 못하거나, 세션 발급 요청 또는 본문 읽기가 실패한 경우.
 */
export async function createG2bSession() {
  const jar = new CookieJar();

  // 다른 출처로 쿠키가 전달되는 일을 막고, 각 응답의 발급·갱신 쿠키를 요청 단위로 보관한다.
  async function request(url: URL, init: RequestInit) {
    if (url.origin !== homepage.origin) throw new Error('나라장터와 출처가 다른 주소입니다.');
    const headers = new Headers(init.headers);
    const cookies = await jar.getCookieString(url.href);
    if (cookies) headers.set('Cookie', cookies);
    else headers.delete('Cookie');
    const response = await fetch(url, { ...init, headers, cache: 'no-store', redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      await jar.setCookie(cookie, url.href, { ignoreError: true });
    }
    return response;
  }

  let url = homepage;
  for (let step = 0; step < 4; step++) {
    const response = await request(url, { signal: AbortSignal.timeout(15000) });
    const location = response.headers.get('Location');
    const next = redirectStatuses.has(response.status) && location ? new URL(location, url) : null;
    if (next?.origin === homepage.origin) {
      await response.body?.cancel();
      url = next;
      continue;
    }
    // 쿠키가 발급됐더라도 최종 본문이 점검 화면이면 API 요청을 시작하지 않는다.
    await readG2bResponse(response);
    // 외부 출처로 이동하라는 응답에서도 나라장터가 이미 발급한 쿠키는 재사용할 수 있다.
    if ((response.ok || next) && (await jar.getCookies(homepage.href)).length) {
      return (apiUrl: URL, init: RequestInit) => {
        const headers = new Headers(init.headers);
        headers.set('Referer', homepage.href);
        headers.set('Usr-Id', 'null');
        return request(apiUrl, { ...init, headers });
      };
    }
    break;
  }
  throw new Error('나라장터 익명 세션을 발급받지 못했습니다.');
}

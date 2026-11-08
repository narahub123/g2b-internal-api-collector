import { CookieJar } from 'tough-cookie';

const homepage = new URL('https://www.g2b.go.kr/');
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/**
 * 나라장터가 발급한 익명 쿠키를 사용하는 요청 함수를 만든다.
 * @returns 나라장터 동일 출처에만 쿠키를 보내는 서버 요청 함수.
 * @throws 홈페이지에서 익명 세션을 발급받지 못했을 때.
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
    await response.body?.cancel();
    const location = response.headers.get('Location');
    const next = redirectStatuses.has(response.status) && location ? new URL(location, url) : null;
    if (next?.origin === homepage.origin) {
      url = next;
      continue;
    }
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

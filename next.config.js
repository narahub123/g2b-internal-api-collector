/**
 * Next.js 개발 서버가 사용하는 애플리케이션 설정.
 * @type {import("next").NextConfig}
 */
module.exports = {
  // 민감한 URL이 포함될 수 있는 개발 요청 로그를 제어한다.
  logging: {
    // OAuth 인가 코드와 state가 개발 서버 요청 로그에 포함되지 않도록 한다.
    incomingRequests: { ignore: [/^\/auth\/google\/callback(?:\?|$)/] },
  },
};

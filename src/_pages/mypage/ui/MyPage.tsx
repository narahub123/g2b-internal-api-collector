/**
 * 회원 공통 레이아웃 아래에 표시할 마이페이지 본문을 구성한다.
 * 기존 본문의 너비와 여백을 유지하고 마이페이지 제목을 표시한다.
 * @returns 마이페이지 제목을 포함한 본문 화면.
 */
export default function MyPage() {
  // 기존 본문의 최대 너비와 여백을 유지한 마이페이지 화면을 반환한다.
  return (
    <main className="mx-auto grid max-w-lg gap-4 px-6 py-10">
      {/* 가입과 로그인 후 도착한 개인 화면을 식별한다. */}
      <h1 className="text-2xl font-semibold">마이페이지</h1>
    </main>
  );
}

import Link from "next/link";
import { ReturnToPrevious } from "@/features/service-auth/PageActivity";

/**
 * 서버 쿼리와 브라우저 기록을 이용하는 복귀 안내를 제공한다.
 * @param props.searchParams 이번에 접근을 거절한 내부 경로를 담은 쿼리.
 * @returns 브라우저 복귀 확인과 스크립트 없이도 열 수 있는 공개 홈 링크.
 */
export default async function AuthReturnPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const { from } = await searchParams;
  return (
    <main className="mx-auto grid min-h-svh max-w-lg content-center gap-4 px-6">
      <h1 className="text-xl font-semibold">페이지 접근 권한이 없습니다</h1>
      <ReturnToPrevious current={from} />
      <Link href="/" className="text-sm underline">홈으로 이동</Link>
    </main>
  );
}

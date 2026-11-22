import Link from "next/link";
import { AuthErrorToast } from "@/features/service-auth/PageActivity";

/**
 * 보호 화면을 표시할 수 없는 인증 장애 시 Sonner 알림과 내부 이동을 제공한다.
 * @returns 비로그인과 로그인 브라우저에서 모두 열리는 인증 오류 화면.
 */
export default function AuthErrorPage() {
  return (
    <main className="mx-auto grid min-h-svh max-w-lg content-center gap-4 px-6">
      <h1 className="text-xl font-semibold">인증 서비스를 확인할 수 없습니다</h1>
      <AuthErrorToast />
      <Link href="/" className="text-sm underline">홈으로 이동</Link>
    </main>
  );
}

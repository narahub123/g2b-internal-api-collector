import BusinessInformation from "@/_pages/mypage/ui/BusinessInformation";
import { requirePageAccess } from "@/server/auth/page-guard";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openBusinessInformation } from "@/server/g2b/repository/business-information";
import { myPageMenuPath } from "@/shared/config/mypage";

/**
 * 로그인 사용자의 사업자 등록 화면과 요약 목록을 준비한다.
 * @returns 현재 사용자의 목록 화면.
 * @throws 접근을 허용하지 않으면 공통 접근 가드가 이동한다.
 */
export default async function BusinessPage() {
  // 레이아웃이 재사용되는 탐색에서도 회원을 먼저 검증한다.
  const auth = await requirePageAccess(myPageMenuPath("business"));
  if (auth?.status !== "authenticated") return null;

  // 인증 사용자의 연결에서 ID, 번호, 업체명만 가져온다.
  const businesses = await openBusinessInformation(getG2bDatabase()).listForUser(auth.user.id);
  // 한 건을 등록했어도 이 페이지에는 목록을 표시한다.
  return <BusinessInformation businesses={businesses} />;
}

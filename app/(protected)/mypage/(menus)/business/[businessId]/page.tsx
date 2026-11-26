import { notFound } from "next/navigation";
import { BusinessDetail } from "@/_pages/mypage/ui/BusinessDetail";
import { requirePageAccess } from "@/server/auth/page-guard";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openBusinessInformation } from "@/server/g2b/repository/business-information";
import { myPageMenuPath, parseMyPageBusinessId } from "@/shared/config/mypage";

/**
 * 로그인 사용자가 등록한 사업자 한 곳의 상세 화면을 제공한다.
 * @param props 상세 경로가 전달하는 비동기 사업자 식별자.
 * @returns 저장된 업무 데이터만 포함하는 상세 화면.
 * @throws 공통 접근 가드가 이동하거나 잘못된 ID와 미등록 사업자는 404로 처리한다.
 */
export default async function BusinessDetailPage({ params }: { params: Promise<{ businessId: string }> }) {
  // 페이지 진입 권한을 확인한 뒤에만 입력과 업무 데이터를 처리한다.
  const auth = await requirePageAccess(myPageMenuPath("business"));
  if (auth?.status !== "authenticated") notFound();
  const id = parseMyPageBusinessId((await params).businessId);
  if (id === undefined) notFound();

  // 등록 관계를 통과한 경우에만 선택한 사업자의 데이터를 읽는다.
  const detail = await openBusinessInformation(getG2bDatabase()).detailForUser(auth.user.id, id);
  if (!detail) notFound();

  // 현재 사업자 ID는 재시도 폼을 구성하는 데 사용한다.
  return <BusinessDetail businessId={id} detail={detail} />;
}

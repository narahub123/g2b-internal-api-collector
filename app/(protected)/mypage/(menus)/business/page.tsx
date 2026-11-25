import BusinessInformation from "@/_pages/mypage/ui/BusinessInformation";
import { withPageAccess } from "@/server/auth/page-guard";
import { myPageMenuPath } from "@/shared/config/mypage";

// 공통 레이아웃이 재사용되는 탐색에서도 회원 검증을 거쳐 사업자 정보 화면을 표시한다.
export default withPageAccess(myPageMenuPath("business"), BusinessInformation);

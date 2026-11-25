import Recommendations from "@/_pages/mypage/ui/Recommendations";
import { withPageAccess } from "@/server/auth/page-guard";
import { myPageMenuPath } from "@/shared/config/mypage";

// 공통 레이아웃이 재사용되는 탐색에서도 회원 검증을 거쳐 추천 화면을 표시한다.
export default withPageAccess(myPageMenuPath("recommendation"), Recommendations);

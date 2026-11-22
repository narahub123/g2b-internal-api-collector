import { withPageAccess } from "@/server/auth/page-guard";
import { G2bDashboardPage } from "@/_pages/admin/g2b/ui/G2bDashboardPage";

// 페이지 진입에서 최신 관리자 권한을 검증한 뒤 데이터 화면을 실행한다.
export default withPageAccess("/admin", G2bDashboardPage);

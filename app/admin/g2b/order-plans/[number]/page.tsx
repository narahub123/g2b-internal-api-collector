import { withPageAccess } from "@/server/auth/page-guard";
import { OrderPlanDetailPage } from "@/_pages/admin/g2b/order-plans/ui/OrderPlanDetailPage";

// 페이지 진입에서 최신 관리자 권한을 검증한 뒤 데이터 화면을 실행한다.
export default withPageAccess("/admin", OrderPlanDetailPage);

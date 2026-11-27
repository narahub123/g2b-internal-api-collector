import { ADMIN_MANAGE_PATH } from "@/_pages/admin/config/routes";
import { ManagePage } from "@/_pages/admin/manage/ManagePage";
import { withPageAccess } from "@/server/auth/page-guard";

// 관리 카드의 저장 건수를 읽기 전에 현재 관리자 권한을 확인한다.
export default withPageAccess(ADMIN_MANAGE_PATH, ManagePage);

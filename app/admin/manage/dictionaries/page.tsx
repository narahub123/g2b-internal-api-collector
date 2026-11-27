import { ADMIN_DICTIONARIES_PATH } from "@/_pages/admin/config/routes";
import { DictionaryManagementPage } from "@/_pages/admin/manage/DictionaryManagementPage";
import { withPageAccess } from "@/server/auth/page-guard";

// 목록 관리 화면의 집계를 관리자에게만 표시한다.
export default withPageAccess(ADMIN_DICTIONARIES_PATH, DictionaryManagementPage);

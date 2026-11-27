import { ADMIN_DICTIONARIES_PATH } from "@/_pages/admin/config/routes";
import { DictionaryDetailPage } from "@/_pages/admin/manage/DictionaryDetailPage";
import { withPageAccess } from "@/server/auth/page-guard";

// 관리자 권한을 확인한 후 상세의 저장 목록을 읽는다.
export default withPageAccess(ADMIN_DICTIONARIES_PATH, DictionaryDetailPage);

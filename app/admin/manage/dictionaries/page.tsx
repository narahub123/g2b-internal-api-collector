import { ADMIN_DICTIONARIES_PATH } from "@/_pages/admin/config/routes";
import { DictionaryManagementPage } from "@/_pages/admin/manage/DictionaryManagementPage";
import { withPageAccess } from "@/server/auth/page-guard";

// 전체 수집에서 두 사전의 원본 요청과 Blob 정리까지 수행할 시간을 확보한다.
export const maxDuration = 300;

// 목록 관리 화면의 집계를 관리자에게만 표시한다.
export default withPageAccess(ADMIN_DICTIONARIES_PATH, DictionaryManagementPage);

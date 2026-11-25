import { withPageAccess } from "@/server/auth/page-guard";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";
import MyPage from "@/_pages/mypage/ui/MyPage";

// 요청별 최신 사용자 상태를 확인한 뒤 개인 정보를 표시한다.
export const dynamic = "force-dynamic";

/**
 * 마이페이지 진입 시 회원 접근 권한을 검증한다.
 * 접근 권한이 확인되면 분리된 마이페이지 화면을 실행한다.
 * @returns 회원 접근 권한 검증이 적용된 마이페이지 컴포넌트.
 * @throws 미인증 또는 인증 장애에서는 공통 인증 경로로 이동한다.
 */
export default withPageAccess(AUTH_SUCCESS_PATH, MyPage);

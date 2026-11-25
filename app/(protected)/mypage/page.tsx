import { redirect } from "next/navigation";
import { withPageAccess } from "@/server/auth/page-guard";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";
import { DEFAULT_MENU_ID, myPageMenuPath } from "@/shared/config/mypage";

/**
 * 진입 주소의 검색 조건을 보존해 기본 메뉴로 이동한다.
 * @param props.searchParams 메뉴 주소에 전달할 단일 값 및 반복 값.
 * @throws 기본 메뉴로 이동하는 Next.js 리디렉션 신호를 보낸다.
 */
async function MyPageEntry({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  // 진입 주소의 검색 조건을 메뉴 주소에서 복원할 수 있도록 인코딩한다.
  const query = new URLSearchParams();
  // 검색 조건마다 전달된 값을 원래 순서대로 처리한다.
  for (const [key, values] of Object.entries(await searchParams)) {
    // 전달되지 않은 키는 건너뛰고 빈 문자열과 반복 값은 유지한다.
    for (const value of values === undefined ? [] : [values].flat()) {
      // 같은 키의 이전 값을 보존하며 새 값을 추가한다.
      query.append(key, value);
    }
  }
  // 공용 설정에서 기본 메뉴의 경로를 결정한다.
  const path = myPageMenuPath(DEFAULT_MENU_ID);
  // 검색 조건이 있을 때만 쿼리를 붙여 임시 이동한다.
  redirect(query.size ? `${path}?${query}` : path);
}

// 기본 메뉴로 이동하기 전에 기존 회원 접근 정책을 적용한다.
export default withPageAccess(AUTH_SUCCESS_PATH, MyPageEntry);

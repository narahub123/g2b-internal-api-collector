import type { ReactNode } from "react";
import MyPage from "@/_pages/mypage/ui/MyPage";

/**
 * 메뉴 경로에 공통 탐색과 현재 페이지를 배치한다.
 * @param props.children 접근한 메뉴 또는 하위 화면.
 * @returns 메뉴 전용 마이페이지 레이아웃.
 */
export default function MyPageMenuLayout({ children }: { children: ReactNode }) {
  // 메뉴 페이지의 본문을 기존 마이페이지 화면에 전달한다.
  return <MyPage>{children}</MyPage>;
}

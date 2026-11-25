import type { ReactNode } from "react";
import { ServiceMain } from "@/shared/ui/ServiceMain";
import MyPageNavigation from "./MyPageNavigation";

/**
 * 기존 본문 안에 마이페이지 제목과 탐색 메뉴를 배치한다.
 * @param props.children 현재 메뉴 경로에서 렌더링한 본문.
 * @returns 공통 제목, 탐색 메뉴 및 현재 본문을 포함한 화면.
 */
export default function MyPage({ children }: { children: ReactNode }) {
  // 기존 본문 폭과 제목·메뉴 사이 간격을 유지한다.
  return (
    <ServiceMain>
      <div className="grid gap-4">
        {/* 화면 크기와 관계없이 동일한 제목을 표시한다. */}
        <h1 className="text-2xl font-semibold">마이페이지</h1>

        {/* 현재 경로에서 선택된 본문을 탐색 메뉴 아래에 표시한다. */}
        <MyPageNavigation>{children}</MyPageNavigation>
      </div>
    </ServiceMain>
  );
}

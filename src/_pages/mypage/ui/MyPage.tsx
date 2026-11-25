import { ServiceMain } from "@/shared/ui/ServiceMain";
import MyPageNavigation from "./MyPageNavigation";
import UserInformation from "./UserInformation";
import BusinessInformation from "./BusinessInformation";
import Recommendations from "./Recommendations";
import Interests from "./Interests";

/** 마이페이지 메뉴 및 표시 순서. */
const menus = [
  {
    id: "user",
    label: "사용자 정보",
    content: <UserInformation />,
  },
  {
    id: "business",
    label: "사업자 정보",
    content: <BusinessInformation />,
  },
  {
    id: "recommendation",
    label: "추천",
    content: <Recommendations />,
  },
  {
    id: "interests",
    label: "관심",
    content: <Interests />,
  },
] as const;

/** 마이페이지 최초 진입 시 표시할 메뉴. */
const DEFAULT_MENU_ID: (typeof menus)[number]["id"] = "user";

/**
 * 마이페이지 본문과 메뉴별 콘텐츠를 구성한다.
 * @returns 마이페이지 화면.
 */
export default function MyPage() {
  return (
    <ServiceMain>
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">마이페이지</h1>

        <MyPageNavigation menus={menus} defaultMenuId={DEFAULT_MENU_ID} />
      </div>
    </ServiceMain>
  );
}

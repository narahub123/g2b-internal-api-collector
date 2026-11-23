import { G2B_LABEL, G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { ADMIN_G2B_PATH, ADMIN_HOME_PATH, NOTICE_QUEUE_PATH } from "./routes";

// 관리자 라우트가 제공되는 분류만 공용 업무 순서대로 표시한다.
const availableSections = [
  "order-plans",
  "contract-requests",
  "prior-specs",
  "notices",
  "opening-results",
  "contracts",
] as const satisfies readonly (keyof typeof G2B_SECTIONS)[];
type AvailableSection = (typeof availableSections)[number];
const availableSectionKeys = new Set<string>(availableSections);

/** 사용자 영역의 사이드바 메뉴. 새 사용자 페이지는 여기에 추가한다. */
export const USER_NAVIGATION = [
  { href: "/", label: "사용자 페이지" },
  { href: "/mypage", label: "마이페이지" },
];

export const ADMIN_NAVIGATION = {
  dashboard: { href: ADMIN_HOME_PATH, label: "대시보드" },
  g2b: {
    href: ADMIN_G2B_PATH,
    label: G2B_LABEL,
    noticeQueue: { href: NOTICE_QUEUE_PATH, label: "공고 수집 큐" },
    sections: (Object.keys(G2B_SECTIONS) as (keyof typeof G2B_SECTIONS)[])
      .filter((section): section is AvailableSection =>
        availableSectionKeys.has(section),
      )
      .map((section) => ({
        section,
        href: `${ADMIN_G2B_PATH}/${section}`,
        label: G2B_SECTIONS[section],
      })),
  },
};

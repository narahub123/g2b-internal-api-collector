import { G2B_LABEL, G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { ADMIN_G2B_PATH, ADMIN_HOME_PATH } from "./routes";

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

export const ADMIN_NAVIGATION = {
  dashboard: { href: ADMIN_HOME_PATH, label: "대시보드" },
  g2b: {
    href: ADMIN_G2B_PATH,
    label: G2B_LABEL,
    sections: (Object.keys(G2B_SECTIONS) as (keyof typeof G2B_SECTIONS)[])
      .filter((section): section is AvailableSection => availableSectionKeys.has(section))
      .map((section) => ({
        section,
        href: `${ADMIN_G2B_PATH}/${section}`,
        label: G2B_SECTIONS[section],
      })),
  },
};

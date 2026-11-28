import { G2B_LABEL, G2B_SECTIONS } from "@/shared/config/g2b-sections";
import {
  ADMIN_G2B_PATH,
  ADMIN_HOME_PATH,
  ADMIN_MANAGE_PATH,
  ADMIN_DICTIONARIES_PATH,
  ADMIN_INDUSTRY_LAW_PATH,
  ADMIN_LEGAL_DISTRICTS_PATH,
  NOTICE_QUEUE_PATH,
} from "./routes";

// 관리자 라우트가 제공되는 분류만 공용 업무 순서대로 표시한다.
const availableSections = [
  "order-plans",
  "contract-requests",
  "prior-specs",
  "notices",
  "opening-results",
  "contracts",
] as const satisfies readonly (keyof typeof G2B_SECTIONS)[];

// 관리자 화면에서 제공하는 나라장터 업무 분류만 허용하는 타입이다.
type AvailableSection = (typeof availableSections)[number];

// 공용 업무 목록에서 관리자 화면이 제공하는 업무를 선별하기 위한 집합이다.
const availableSectionKeys = new Set<string>(availableSections);

/** 사이드바 메뉴의 이동 경로, 표시 이름, 활성화 조건 및 하위 메뉴를 정의한다. */
export type NavigationItem = {
  /** 메뉴를 선택했을 때 이동할 페이지의 경로다. */
  href: string;

  /** 사이드바에 표시할 메뉴 이름이다. */
  label: string;

  /**
   * 하위 경로에서도 해당 메뉴를 활성화할지 지정한다.
   * true이면 현재 경로가 메뉴 경로 또는 그 하위 경로일 때 활성화한다.
   * false이거나 생략하면 메뉴 경로와 정확히 일치할 때만 활성화한다.
   */
  matchBranch?: boolean;

  /**
   * 현재 메뉴 아래에 표시할 하위 메뉴 목록이다.
   * 동일한 메뉴 타입을 사용하여 여러 단계의 계층을 구성할 수 있다.
   * 하위 메뉴가 없으면 생략한다.
   */
  children?: NavigationItem[];
};

/**
 * 관리자 화면에서 제공하는 나라장터 업무인지 확인한다.
 * 미구현 업무가 관리자 메뉴에 표시되지 않도록 선별하는 데 사용한다.
 * @param section 확인할 나라장터 업무 분류다.
 * @returns 관리자 화면에서 제공하는 업무이면 true, 아니면 false를 반환한다.
 */
function isAvailableSection(
  section: keyof typeof G2B_SECTIONS,
): section is AvailableSection {
  // 관리자 업무 집합에 해당 분류가 포함되어 있는지 확인한다.
  return availableSectionKeys.has(section);
}

/**
 * 나라장터 업무 분류를 관리자 공통 업무 이동 정보로 변환한다.
 * 사이드바, 업무 이동 탭 및 업무별 현황 카드에서 동일한 정보를 사용한다.
 * @param section 관리자 화면에서 제공하는 나라장터 업무 분류다.
 * @returns 업무 분류, 이동 경로, 표시 이름 및 활성화 조건을 포함한 정보.
 */
function createSectionNavigation(section: AvailableSection) {
  // 각 화면에서 공통으로 사용할 업무 이동 정보를 반환한다.
  return {
    section,
    href: `${ADMIN_G2B_PATH}/${section}`,
    label: G2B_SECTIONS[section],
    matchBranch: true,
  };
}

/**
 * 사이드바, 업무 이동 탭 및 업무별 현황 카드에서 공통으로 사용하는 나라장터 업무 목록이다.
 * 공용 업무 순서를 유지하면서 관리자 화면에서 제공하는 업무만 포함한다.
 */
export const ADMIN_G2B_SECTIONS = (
  Object.keys(G2B_SECTIONS) as (keyof typeof G2B_SECTIONS)[]
)
  .filter(isAvailableSection)
  .map(createSectionNavigation);

/** 사용자 영역의 사이드바 메뉴. 새 사용자 페이지는 여기에 추가한다. */
export const USER_NAVIGATION = [
  // 서비스의 사용자 메인 페이지로 이동한다.
  { href: "/", label: "사용자 페이지" },

  // 사용자의 계정 및 개인 정보 관리 페이지로 이동한다.
  { href: "/mypage", label: "마이페이지" },
];

/**
 * 관리자 영역의 사이드바 메뉴를 표시 순서대로 정의한다.
 * 상위 메뉴는 배열에 추가하고 하위 메뉴는 해당 메뉴의 children에 추가한다.
 * 하위 메뉴도 children을 가질 수 있으므로 여러 단계의 메뉴를 구성할 수 있다.
 */
export const ADMIN_NAVIGATION: NavigationItem[] = [
  // 관리자 대시보드로 이동하는 단독 메뉴다.
  { href: ADMIN_HOME_PATH, label: "대시보드" },

  // 나라장터 관리 페이지와 업무별 하위 메뉴를 구성한다.
  {
    href: ADMIN_G2B_PATH,
    label: G2B_LABEL,
    children: [
      // 공통 나라장터 업무 목록을 하위 메뉴에 표시한다.
      ...ADMIN_G2B_SECTIONS,

      // 업무 목록 다음에 입찰공고 수집 큐 관리 메뉴를 표시한다.
      { href: NOTICE_QUEUE_PATH, label: "공고 수집 큐" },
    ],
  },

  // 공통 관리 기능의 상위 메뉴와 하위 메뉴를 구성한다.
  {
    href: ADMIN_MANAGE_PATH,
    label: "관리",
    children: [
      // 수집된 사전 목록을 조회하고 관리하는 페이지로 이동한다.
      {
        href: ADMIN_DICTIONARIES_PATH,
        label: "사전 목록",
        children: [
          // 업종 및 근거법규 목록을 조회하는 페이지로 이동한다.
          {
            href: ADMIN_INDUSTRY_LAW_PATH,
            label: "업종 코드",
          },

          // 법정동 코드 목록을 조회하는 페이지로 이동한다.
          {
            href: ADMIN_LEGAL_DISTRICTS_PATH,
            label: "법정동 코드",
          },
        ],
      },
    ],
  },
];

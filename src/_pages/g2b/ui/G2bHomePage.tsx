import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { loadCollectionList } from "@/server/g2b/repository/load-collection-list";
import { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { formatCollectionIdentifier, type CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import { CollectionListItem } from "@/shared/ui/g2b/CollectionListItem";
import { CollectionListLabel } from "@/shared/ui/g2b/CollectionListLabel";
import { CollectionQueryView } from "@/shared/ui/g2b/CollectionQueryView";
import { G2bSectionNav } from "@/shared/ui/g2b/G2bSectionNav";
import { ServiceMain } from "@/shared/ui/ServiceMain";
import { userDetailPath } from "../config/routes";

// 저장 건수와 무관하게 목록 조회가 구현된 단계만 공통 업무 순서대로 노출한다.
const availableSections = {
  "order-plans": true,
  "contract-requests": true,
  "prior-specs": true,
  notices: true,
  "opening-results": true,
  contracts: true,
} satisfies Record<CollectionSection, true>;

function isAvailableSection(value: unknown): value is CollectionSection {
  return typeof value === "string" && Object.hasOwn(availableSections, value);
}

const sectionItems = Object.keys(G2B_SECTIONS).filter(isAvailableSection).map((section) => ({
  section,
  label: G2B_SECTIONS[section],
  href: `/?section=${section}`,
}));

/**
 * 업무 탭과 저장된 나라장터 자료를 표시한다. 단계가 생략되거나 미지원이면 입찰공고를 조회한다.
 * @throws Turso에서 선택한 업무의 자료나 필터 선택지를 읽지 못한 경우.
 */
export async function G2bHomePage({ searchParams }: { searchParams: Promise<CollectionSearchParams> }) {
  const params = await searchParams;
  const section = isAvailableSection(params.section) ? params.section : "notices";
  const { query, result, businesses, ...list } = await loadCollectionList(section, params, "collected", {
    excludeMockNotices: section === "notices",
  });
  const listQuery = { ...query, status: "total", page: result.page } as const;
  // URL 원본 대신 검증된 조건과 저장소에서 보정한 페이지를 복귀 주소에 담는다.
  const from = new URLSearchParams(list.href("/", listQuery).split("?")[1]);
  from.set("section", section);
  const detailQuery = new URLSearchParams({ from: `/?${from}` });

  // 관리자 목록과 같은 본문 폭과 간격으로 업무 제목, 탭, 검색과 결과를 배치한다.
  return (
    <ServiceMain>
      <section aria-labelledby="g2b-list-heading" className="grid min-w-0 gap-6">
        {/* 현재 업무 이름을 목록 제목으로 한 번 표시한다. */}
        <h1 id="g2b-list-heading" className="text-2xl font-semibold">{G2B_SECTIONS[section]}</h1>
        {/* 선택한 업무를 강조하고 다른 업무 목록으로 이동할 수 있게 한다. */}
        <G2bSectionNav items={sectionItems} activeSection={section} />
        <CollectionQueryView
          key={section}
          path="/"
          persistentParams={{ section }}
          query={listQuery}
          totalPages={result.totalPages}
          businesses={businesses}
          {...(list.section === "notices"
            ? { section: list.section, regions: list.regions }
            : { section: list.section })}
        >
          {result.rows.length ? (
            <ul className="grid gap-2">
              {result.rows.map((row) => (
                <CollectionListItem
                  key={JSON.stringify([row.number, row.revision, row.openingRevision])}
                  href={`${userDetailPath(section, row)}?${detailQuery}`}
                >
                  <CollectionListLabel
                    identifier={formatCollectionIdentifier(row)}
                    title={row.title}
                    businessCode={row.businessCode}
                    businessLabel={row.businessLabel}
                  />
                </CollectionListItem>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">해당하는 자료가 없습니다.</p>}
        </CollectionQueryView>
      </section>
    </ServiceMain>
  );
}

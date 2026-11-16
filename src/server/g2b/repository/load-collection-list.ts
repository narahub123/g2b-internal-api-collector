import { noticeListHref, parseNoticeListQuery } from "@/entities/notice/model/notice-list-query";
import { collectionListHref, type CollectionListQuery, type CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import { parsePriorSpecListQuery } from "@/entities/prior-spec/model/prior-spec-list-query";
import { parseOpeningResultListQuery } from "@/entities/opening-result/model/opening-result-list-query";
import { parseContractListQuery } from "@/entities/contract/model/contract-list-query";
import { orderPlanListHref, parseOrderPlanListQuery } from "@/entities/order-plan/model/order-plan-list-query";
import { contractRequestListHref, parseContractRequestListQuery } from "@/entities/contract-request/model/contract-request-list-query";
import { getG2bRepository } from "./index";
import type { CollectionSection } from "./collection-attempts";

/**
 * 업무별 URL 조건을 검증하고 저장소에서 목록 페이지와 필터 선택지를 조회한다.
 * @param fixedStatus URL에 관계없이 조회할 수집 상태. 생략하면 검증된 URL 조건을 사용한다.
 * @param noticeOptions 사용자 입찰공고 목록에서 모의공고를 제외할지 지정한다.
 * @throws Turso에서 목록이나 필터 선택지를 조회하지 못한 경우.
 */
export async function loadCollectionList(
  section: CollectionSection,
  params: CollectionSearchParams,
  fixedStatus?: CollectionListQuery["status"],
  noticeOptions?: { excludeMockNotices?: boolean },
) {
  const attempts = getG2bRepository().collectionAttempts;
  const withStatus = (query: CollectionListQuery) => fixedStatus ? { ...query, status: fixedStatus } : query;
  if (section === "prior-specs" || section === "opening-results" || section === "contracts") {
    const [list, parse] = ({
      "prior-specs": [attempts.priorSpecList, parsePriorSpecListQuery],
      "opening-results": [attempts.openingResultList, parseOpeningResultListQuery],
      contracts: [attempts.contractList, parseContractListQuery],
    } as const)[section];
    const businesses = await list.businesses();
    const query = withStatus(parse(params, businesses));
    return { section, businesses, query, result: await list.page(query), href: collectionListHref } as const;
  }
  if (section === "contract-requests") {
    const businesses = await attempts.contractRequestList.businesses();
    const query = withStatus(parseContractRequestListQuery(params, businesses));
    return { section, businesses, query, result: await attempts.contractRequestList.page(query), href: contractRequestListHref } as const;
  }
  if (section === "order-plans") {
    const businesses = await attempts.orderPlanList.businesses();
    const query = withStatus(parseOrderPlanListQuery(params, businesses));
    return { section, businesses, query, result: await attempts.orderPlanList.page(query), href: orderPlanListHref } as const;
  }
  const regions = await attempts.noticeList.regions(noticeOptions);
  const businesses = await attempts.noticeList.businesses(noticeOptions);
  const query = withStatus(parseNoticeListQuery(params, regions, businesses));
  return { section, regions, businesses, query, result: await attempts.noticeList.page(query, noticeOptions), href: noticeListHref } as const;
}

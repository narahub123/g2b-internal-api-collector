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
 * @throws SQLite에서 목록이나 필터 선택지를 조회하지 못한 경우.
 */
export function loadCollectionList(
  section: CollectionSection,
  params: CollectionSearchParams,
  fixedStatus?: CollectionListQuery["status"],
) {
  const attempts = getG2bRepository().collectionAttempts;
  const withStatus = (query: CollectionListQuery) => fixedStatus ? { ...query, status: fixedStatus } : query;
  if (section === "prior-specs" || section === "opening-results" || section === "contracts") {
    const [list, parse] = ({
      "prior-specs": [attempts.priorSpecList, parsePriorSpecListQuery],
      "opening-results": [attempts.openingResultList, parseOpeningResultListQuery],
      contracts: [attempts.contractList, parseContractListQuery],
    } as const)[section];
    const businesses = list.businesses();
    const query = withStatus(parse(params, businesses));
    return { section, businesses, query, result: list.page(query), href: collectionListHref } as const;
  }
  if (section === "contract-requests") {
    const businesses = attempts.contractRequestList.businesses();
    const query = withStatus(parseContractRequestListQuery(params, businesses));
    return { section, businesses, query, result: attempts.contractRequestList.page(query), href: contractRequestListHref } as const;
  }
  if (section === "order-plans") {
    const businesses = attempts.orderPlanList.businesses();
    const query = withStatus(parseOrderPlanListQuery(params, businesses));
    return { section, businesses, query, result: attempts.orderPlanList.page(query), href: orderPlanListHref } as const;
  }
  const regions = attempts.noticeList.regions();
  const businesses = attempts.noticeList.businesses();
  const query = withStatus(parseNoticeListQuery(params, regions, businesses));
  return { section, regions, businesses, query, result: attempts.noticeList.page(query), href: noticeListHref } as const;
}

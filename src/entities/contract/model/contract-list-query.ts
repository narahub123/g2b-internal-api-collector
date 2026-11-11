import { parseCollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import type { ListFilter, ListOption } from "@/shared/ui/list-controls/model";

/** 계약현황 목록의 검색 대상과 필터 및 정렬 항목을 구성한다. */
export function contractListControls(businesses: readonly ListOption[]) {
  const filters: ListFilter[] = [
    { id: "business", type: "multi-select", label: "업무구분", options: businesses },
    { id: "date", type: "date-range", label: "계약일자" },
  ];
  return {
    fields: [
      { value: "title", label: "계약명" },
      { value: "number", label: "계약번호" },
      { value: "agency", label: "수요기관" },
    ],
    filters,
    sort: [
      { value: "date-desc", label: "계약일자 최신순" },
      { value: "date-asc", label: "계약일자 오래된순" },
      { value: "title-asc", label: "계약명 오름차순" },
      { value: "title-desc", label: "계약명 내림차순" },
    ],
  };
}

/** 목록 URL에서 해당 업무에 정의된 검색·필터·정렬 조건만 읽는다. */
export function parseContractListQuery(params: CollectionSearchParams, businesses: readonly ListOption[]) {
  return parseCollectionListQuery(params, contractListControls(businesses));
}

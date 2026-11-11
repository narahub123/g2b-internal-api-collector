import { parseCollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import type { ListFilter, ListOption } from "@/shared/ui/list-controls/model";

/** 사전규격 목록의 검색 대상과 필터 및 정렬 항목을 구성한다. */
export function priorSpecListControls(businesses: readonly ListOption[]) {
  const filters: ListFilter[] = [
    { id: "business", type: "multi-select", label: "업무구분", options: businesses },
    { id: "budget", type: "number-range", label: "배정예산액(원화)", unit: "원" },
    { id: "budgetUsd", type: "number-range", label: "배정예산액(외자)", unit: "USD" },
    { id: "date", type: "date-range", label: "사전규격 공개일시" },
  ];
  return {
    fields: [
      { value: "title", label: "사전규격명" },
      { value: "number", label: "사전규격등록번호" },
      { value: "agency", label: "수요기관" },
    ],
    filters,
    sort: [
      { value: "date-desc", label: "사전규격 공개일시 최신순" },
      { value: "date-asc", label: "사전규격 공개일시 오래된순" },
      { value: "title-asc", label: "사전규격명 오름차순" },
      { value: "title-desc", label: "사전규격명 내림차순" },
    ],
  };
}

/** 목록 URL에서 해당 업무에 정의된 검색·필터·정렬 조건만 읽는다. */
export function parsePriorSpecListQuery(params: CollectionSearchParams, businesses: readonly ListOption[]) {
  return parseCollectionListQuery(params, priorSpecListControls(businesses));
}

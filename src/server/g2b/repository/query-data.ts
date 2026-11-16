import { searchText } from "./collection-list-query";
import { contractFields } from "./contract-list";
import { contractRequestFields } from "./contract-request-list";
import { mockNoticeFlag, noticeFields, regionsFrom } from "./notice-list";
import { openingResultFields } from "./opening-result-list";
import { orderPlanFields } from "./order-plan-list";
import { priorSpecFields } from "./prior-spec-list";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { getNoticeOrderPlanNumber } from "@/entities/order-plan/model/order-plan";
import type { Notice } from "@/entities/notice/model/types";
import type { OpeningResult } from "@/entities/opening-result/model/opening-result";
import type { OrderPlan } from "@/entities/order-plan/model/order-plan";
import type { PriorSpec } from "@/entities/prior-spec/model/prior-spec";
import type { Contract } from "@/entities/contract/model/contract";
import type { ContractRequest } from "@/entities/contract-request/model/contract-request";

// SQL에서 부분 일치를 적용하기 전에 검색 대상 텍스트만 동일한 규칙으로 정규화한다.
function fieldsForSearch(raw: string) {
  const fields = JSON.parse(raw);
  for (const key of ["agency", "receipt"]) {
    if (key in fields) fields[key] = searchText(fields[key]);
  }
  for (const key of ["agencies", "names"]) {
    if (Array.isArray(fields[key])) fields[key] = fields[key].map(searchText);
  }
  fields.searchTitle = searchText(fields.sortTitle);
  return fields;
}

/** 공고 원본과 함께 쓸 검색·연결·상세 검증 값을 계산한다. */
export function noticeQueryData(notice: Notice, usable: boolean): string {
  const detail = notice.payload?.dmItemMap as Record<string, unknown> | undefined;
  const raw = JSON.stringify(notice);
  const linkedCode = typeof detail?.prcmBsneSeCd === "string" || typeof detail?.prcmBsneSeCd === "number"
    ? String(detail.prcmBsneSeCd).replace(/^ +| +$/g, "") : "";
  const linkedBusiness = resolveG2bBusiness(linkedCode, detail?.prcmBsneSeNm);
  return JSON.stringify({
    fields: fieldsForSearch(noticeFields(raw)),
    mock: mockNoticeFlag(raw),
    usable: Number(usable),
    regionOptions: regionsFrom(detail?.rgnLmtCn),
    orderPlanLookup: notice.payload ? getNoticeOrderPlanNumber(notice.payload) : null,
    openingSearchTitle: notice.title?.replace(/^ +| +$/g, "") ? searchText(notice.title) : null,
    linkedAgency: searchText(detail?.dmstUntyGrpNm),
    linkedCode: linkedCode || null,
    linkedBusiness: linkedBusiness ? [linkedBusiness] : null,
  });
}

/** 개찰 결과에 저장할 조회값을 계산한다. 연결 공고의 값은 조회 시 우선 적용한다. */
export function openingQueryData(result: OpeningResult): string {
  const raw = JSON.stringify(result);
  const { price, results } = result;
  const trim = (value: unknown) => typeof value === "string" ? value.replace(/^ +| +$/g, "") : "";
  const title = trim(price?.pbancInfo?.bidPbancNm) || results?.map((entry: {
    detail?: { bidPbancNm?: string; bidPrgrs?: { bidPbancNm?: string }; bidInfo?: { bidPbancNm?: string } };
  }) => trim(entry.detail?.bidPbancNm) || trim(entry.detail?.bidPrgrs?.bidPbancNm) ||
    trim(entry.detail?.bidInfo?.bidPbancNm)).find(Boolean);
  // 연결 공고에 코드가 없으면 결과 전체에 동일하게 기록된 코드가 공고의 명칭보다 우선한다.
  const codes = new Set(results.map(({ query }) => query.businessCode).filter((code) => code != null));
  const singleCode = codes.size === 1 ? resolveG2bBusiness(codes.values().next().value, undefined) : undefined;
  return JSON.stringify({
    fields: fieldsForSearch(openingResultFields(raw)),
    singleBusiness: singleCode ? [singleCode] : null,
    searchTitle: searchText(title),
  });
}

/** 목록 쿼리의 기존 표시 제목과 업무별 검색 필드를 원본 행에 함께 기록할 값으로 만든다. */
export function collectionQueryData(
  ...input: ["order-plans", OrderPlan] | ["prior-specs", PriorSpec] |
    ["contracts", Contract] | ["contract-requests", Omit<ContractRequest, "number" | "revision" | "collectedAt">]
): string {
  const [section, value] = input;
  const raw = JSON.stringify(value);
  let fields: string;
  let title: unknown;
  switch (section) {
    case "order-plans": {
      const detail = value.payload?.dlOderPlanM as Record<string, unknown> | undefined;
      fields = orderPlanFields(raw);
      title = typeof detail?.bizNm === "string" && detail.bizNm.replace(/^ +| +$/g, "")
        ? detail.bizNm : detail?.itemNm;
      break;
    }
    case "prior-specs": {
      const detail = value.payload?.dlBfSpecM as Record<string, unknown> | undefined;
      fields = priorSpecFields(raw, detail?.prcmBsneSeCd, detail?.prcmBsneSeCdNm);
      title = detail?.bfSpecNm;
      break;
    }
    case "contracts":
      fields = contractFields(raw, value.detail?.prcmBsneSeCd, value.detail?.prcmBsneSeNm);
      title = value.detail?.ctrtNm;
      break;
    case "contract-requests":
      fields = contractRequestFields(raw, true);
      title = value.detail?.bizNm;
      break;
  }
  return JSON.stringify({ fields: fieldsForSearch(fields), searchTitle: searchText(title) });
}

import type { DatabaseSync } from "node:sqlite";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, openCollectionList, sortDate } from "./collection-list-query";

function asAmount(raw: unknown) {
  const value = typeof raw === "number" ||
    (typeof raw === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(raw.trim())) ? Number(raw) : null;
  return Number.isFinite(value) ? value : null;
}

function listFields(raw: unknown, rawCode: unknown, rawLabel: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const business = resolveG2bBusiness(rawCode, rawLabel);
  const businesses = business ? [business] : [];
  const detail = data?.payload?.dlBfSpecM;
  // 외자 상세의 달러 금액과 원화 금액을 같은 범위에서 비교하지 않는다.
  const foreign = business?.code === "02" || business?.code === "04";
  return JSON.stringify({
    date: sortDate(detail?.specRlsDt),
    agencies: [cleanText(detail?.dmstUntyGrpNm)].filter(Boolean),
    receipt: cleanText(detail?.bfSpecRegNo),
    businesses,
    budget: !foreign ? asAmount(detail?.alotBgtPrspAmt) : null,
    budgetUsd: foreign ? asAmount(detail?.alotBgtPrspAmt) : null,
  });
}

/**
 * 사전규격 원본에서 목록 조회용 필드를 추출하고 공통 페이지 조회에 연결한다.
 * @throws SQLite 함수 등록 또는 조회문 준비가 실패한 경우.
 */
export function openPriorSpecList(db: DatabaseSync, targets: string) {
  db.function("prior_spec_list_fields", { deterministic: true }, listFields);
  return openCollectionList(db, "prior-specs", targets,
    "prior_spec_list_fields(saved.data, saved.businessCode, saved.businessLabel)",
    (range) => {
      // 두 범위가 지정되면 사전규격의 통화에 맞는 범위 하나를 충족하면 된다.
      const conditions = [
        range("budget", "json_extract(fields, '$.budget')"),
        range("budgetUsd", "json_extract(fields, '$.budgetUsd')"),
      ].filter(Boolean);
      return conditions.length ? `(${conditions.map((value) => `(${value})`).join(" OR ")})` : "";
    },
  );
}

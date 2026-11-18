import { orderPlanUnprocessableStatus } from "@/shared/config/g2b-order-plan";

// 조회와 부분 인덱스에 같은 식을 사용해야 SQLite가 인덱스를 선택할 수 있다.
export const orderPlanLookupSql = "json_extract(query_data, '$.orderPlanLookup')";
export const orderPlanNumberSql = "json_extract(data, '$.orderPlanNumber')";
export const orderPlanLinkPredicate = `${orderPlanLookupSql} IS NOT NULL
  AND CASE WHEN json_valid(data) THEN json_type(data, '$.orderPlanNumber') = 'text' END`;
export const orderPlanUnavailablePredicate = `${orderPlanLookupSql} IS NOT NULL
  AND CASE WHEN json_valid(data)
    THEN json_extract(data, '$.orderPlanStatus') = '${orderPlanUnprocessableStatus}' END`;

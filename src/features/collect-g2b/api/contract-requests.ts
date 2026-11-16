import { collectionAsyncStep, collectionStep, collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";
import { contractRequestRevision, type ContractRequestKey } from "@/entities/contract-request/model/contract-request";
import { getG2bRepository } from "@/server/g2b/repository";
import { findMaintenance, throwIfMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { postG2b } from "./request";
import { collectOnce } from "./collect-once";
import { trackCollectionAttempt, trackCollectionLookup } from "./collection-attempt";
import { unifiedSearchPath } from "./work-progress";

// 품목 API의 요청 크기와 마지막 페이지 판정에 같은 기준을 사용한다.
const contractItemPageSize = 10;

/**
 * 계약요청 상세 또는 품목 조회에 공통으로 사용하는 검색 조건을 구성한다.
 *
 * @param endpoint 상세·품목 조회 API 이름.
 * @param key 계약요청 식별자.
 * @param page 품목 조회 페이지.
 * @returns API 조회 Promise.
 */
function fetchContractRequestData(
  endpoint: string,
  { number, revision }: ContractRequestKey,
  page = 1,
) {
  return postG2b(
    `${unifiedSearchPath}/${endpoint}.do`,
    "FIUA027_01_wframe_popupCnts_dmndWfrm_srchDtl",
    {
      dlSrchParamM: {
        untyInspIgiNo: "",
        untyPyprNo: "",
        ctrtDmndRcptNo: "",
        ctrtDmndRcptOrd: "",
        page: String(page),
        pageSize: String(contractItemPageSize),
        ctrtNo: "",
        ctrtChgOrd: "",
        bizNo: number,
        bizOrd: revision,
        prcmBsneSeCd: "",
      },
    },
  );
}

/**
 * 계약요청 품목 API를 한 번 호출하여 전체 품목을 조회한다.
 * 응답 배열과 계약요청 식별자를 검증한 뒤 품목 목록을 반환한다.
 *
 * @param key 계약요청 식별자.
 * @param checkMaintenance 상세 조회에서 확인된 점검 상태를 조회 전에 검사하는 함수.
 * @returns 검증을 통과한 품목 목록.
 * @throws 점검 상태, API 조회 실패, 응답 형식 오류 또는 계약요청 식별자 불일치 시.
 */
async function collectContractRequestItems(
  key: ContractRequestKey,
  checkMaintenance: () => void,
) {
  // 상세 조회에서 시스템 점검이 확인되었다면 품목 API 호출 전에 중단한다.
  checkMaintenance();

  // 페이지 반복 조회 없이 API를 한 번 호출하여 품목 목록을 가져온다.
  const result = await fetchContractRequestData("srchDmndSttusItemSql", key);

  const rows = result.dlTotalSrchItemL;

  // 모든 품목이 요청한 계약요청 번호와 차수에 속하는지 확인한다.
  // 응답이 배열이 아니면 식별자 검사를 생략하고 아래에서 형식 오류로 처리한다.
  const invalidIndex = Array.isArray(rows)
    ? rows.findIndex(
        (row) =>
          row?.ctrtDmndRcptNo !== key.number ||
          contractRequestRevision(row?.ctrtDmndRcptOrd) !== key.revision,
      )
    : -1;

  // 응답 형식이 잘못되었거나 다른 계약요청의 품목이 포함되면 오류를 발생시킨다.
  if (!Array.isArray(rows) || invalidIndex >= 0) {
    const row = rows?.[invalidIndex];

    throw collectionValidationError(
      "요청한 계약요청의 품목 응답을 받지 못했습니다.",
      "dlTotalSrchItemL",
      key,
      {
        number: row?.ctrtDmndRcptNo,
        revision: row?.ctrtDmndRcptOrd,
      },
    );
  }

  // 품목 수와 관계없이 검증을 통과한 응답 배열 전체를 반환한다.
  return rows;
}

/**
 * 상세와 전체 품목을 검증한 뒤 계약요청 한 건으로 저장한다.
 * 상세에서 점검이 확인되면 진행 중인 품목 요청 이후 다음 페이지 조회를 보류한다.
 * @param key 계약요청접수번호와 차수.
 * @param force 기본값은 false. true이면 기존 자료도 다시 조회한다.
 * @throws 점검, 상세·품목 조회 또는 검증 실패, 저장소 접근 실패가 발생한 경우. 조회나 검증이 실패하면 기존 자료를 유지한다.
 */
export async function collectContractRequest(
  key: ContractRequestKey,
  force = false,
) {
  const repository = getG2bRepository();
  return collectOnce(
    `contract-request:${key.number}/${key.revision}`,
    force,
    async () => {
      if (!force && await trackCollectionLookup({ section: "contract-requests", ...key }, "계약요청", () => repository.findContractRequest(key))) return;
      return trackCollectionAttempt({ section: "contract-requests", ...key }, async (recordFailure) => {
        const collectedAt = new Date().toISOString();
        // 상세에서 점검을 확인하면 진행 중인 품목 요청 이후에는 다음 페이지를 요청하지 않는다.
        let maintenance: ReturnType<typeof findMaintenance>;
        const [summary, items] = await Promise.allSettled([
          fetchContractRequestData("srchDmndSttusSql", key).catch((error: unknown) => {
            maintenance = findMaintenance(error);
            throw error;
          }),
          collectContractRequestItems(key, () => {
            if (maintenance) throw maintenance;
          }),
        ]);
        if (summary.status === "rejected" && items.status === "rejected") {
          const preferred = findMaintenance(summary.reason) ?? findMaintenance(items.reason) ?? summary.reason;
          for (const reason of new Set([summary.reason, items.reason])) {
            if (reason !== preferred) recordFailure(reason);
          }
          throw preferred;
        }
        throwIfMaintenance(summary, items);
        if (summary.status === "rejected") throw summary.reason;
        if (items.status === "rejected") throw items.reason;
        const result = summary.value;
        const detail =
          Array.isArray(result.dlTotalSrchL) &&
          result.dlTotalSrchL.find(
            (row: Record<string, unknown>) =>
              row?.bizNo === key.number &&
              contractRequestRevision(row.bizOrd) === key.revision,
          );
        if (!detail) {
          const first = result.dlTotalSrchL?.[0];
          throw collectionValidationError("요청한 계약요청의 상세 응답을 받지 못했습니다.", "dlTotalSrchL", key,
            { number: first?.bizNo, revision: first?.bizOrd });
        }
        await collectionAsyncStep("저장소 계약요청 저장", () => repository.saveContractRequest({
          ...key,
          collectedAt,
          detail,
          items: items.value,
        }));
      });
    },
  );
}

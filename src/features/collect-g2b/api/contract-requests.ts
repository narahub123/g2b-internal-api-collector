import { collectionStep, collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";
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
 * 계약요청 품목을 페이지 단위로 모두 조회하고 식별자 및 반복 페이지를 검사한다.
 * 같은 페이지가 반복되면 종료 조건에 도달하지 못할 수 있어 오류로 처리한다.
 *
 * @param key 계약요청 식별자.
 * @param checkMaintenance 상세 조회에서 점검을 확인했으면 다음 품목 요청 전에 중단하는 검사.
 * @returns 검증을 통과한 전체 품목 목록.
 * @throws 상세 또는 품목에서 점검을 확인했거나, 조회에 실패했거나, 다른 식별자 또는 반복 페이지를 받은 경우.
 */
async function collectContractRequestItems(
  key: ContractRequestKey,
  checkMaintenance: () => void,
) {
  const items: Record<string, unknown>[] = [];
  const seenPages = new Set<string>();
  for (let page = 1; ; page++) {
    checkMaintenance();
    const result = await fetchContractRequestData(
      "srchDmndSttusItemSql",
      key,
      page,
    );
    const rows = result.dlTotalSrchItemL;
    const invalidIndex = Array.isArray(rows) ? rows.findIndex((row) =>
      row?.ctrtDmndRcptNo !== key.number || contractRequestRevision(row?.ctrtDmndRcptOrd) !== key.revision) : -1;
    if (!Array.isArray(rows) || invalidIndex >= 0) {
      const row = rows?.[invalidIndex];
      throw collectionValidationError("요청한 계약요청의 품목 응답을 받지 못했습니다.", "dlTotalSrchItemL", key,
        { number: row?.ctrtDmndRcptNo, revision: row?.ctrtDmndRcptOrd });
    }
    // API가 다음 페이지에도 같은 품목을 반환하면 중복 저장과 무한 조회를 막는다.
    const signature = JSON.stringify(rows.map(({ rowNum, ...item }) => item));
    if (seenPages.has(signature))
      throw new Error(
        "나라장터가 같은 계약요청 품목 페이지를 반복 반환했습니다.",
      );
    seenPages.add(signature);
    items.push(...rows);
    if (rows.length < contractItemPageSize) return items;
  }
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
        collectionStep("SQLite 계약요청 저장", () => repository.saveContractRequest({
          ...key,
          collectedAt,
          detail,
          items: items.value,
        }));
      });
    },
  );
}

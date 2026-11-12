import { collectionStep, collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";
import { contractRevision, contractSearchBody, parseContractResponse, type ContractKey } from "@/entities/contract/model/contract";
import { getG2bRepository } from "@/server/g2b/repository";
import { postG2b } from "./request";
import { collectOnce } from "./collect-once";
import { trackCollectionAttempt, trackCollectionLookup } from "./collection-attempt";
import { unifiedSearchPath } from "./work-progress";

/**
 * 계약현황 상세와 세 목록을 조회하고 요청한 계약과 일치하는 응답만 저장한다.
 * 일반 수집은 해당 계약의 저장 자료가 있으면 조회를 생략한다.
 * @param key 계약번호와 정규화된 변경차수.
 * @param force 기본값은 false. true이면 기존 상세도 다시 조회한다.
 * @throws 점검, 조회 실패, 응답 불일치 또는 저장소 접근 실패가 발생한 경우.
 */
export async function collectContract(key: ContractKey, force = false) {
  const repository = getG2bRepository();
  return collectOnce(
    `contract:${key.number}/${key.revision}`,
    force,
    async () => {
      if (!force && await trackCollectionLookup({ section: "contracts", ...key }, "계약현황", () => repository.findContract(key))) return;
      return trackCollectionAttempt({ section: "contracts", ...key }, async () => {
        const collectedAt = new Date().toISOString();
        const result = await postG2b(
          `${unifiedSearchPath}/srchCtrtDtl.do`,
          "FIUA027_01_wframe_popupCnts_ctrtWfrm_srchDtl",
          contractSearchBody(key),
        );
        const contract = parseContractResponse(key, result);
        if (!contract) {
          const detail = result?.dlCtrtMngLstM;
          const message = "요청한 계약현황의 상세 응답을 받지 못했습니다.";
          if (detail?.ctrtNo !== key.number || contractRevision(detail?.ctrtChgOrd) !== key.revision) {
            throw collectionValidationError(message, "dlCtrtMngLstM", key, { number: detail?.ctrtNo, revision: detail?.ctrtChgOrd });
          }
          const fields = ["dlCtrtEtpsLstL", "dlCtrtEtpsSvsLstL", "dlCtrtItemLstL"];
          const invalid = fields.filter((field) => !Array.isArray(result[field]) ||
            result[field].some((row: unknown) => row === null || typeof row !== "object" || Array.isArray(row)));
          throw collectionValidationError(message, invalid.join(", "));
        }
        collectionStep("SQLite 계약현황 저장", () => repository.saveContract({ ...key, collectedAt, ...contract }));
      });
    },
  );
}

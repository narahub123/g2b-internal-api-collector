import { collectionAsyncStep, collectionValidationError, describeCollectionError } from "@/shared/api/g2b/collection-diagnostic";
import { getG2bRepository } from "@/server/g2b/repository";
import type { PriorSpec } from "@/entities/prior-spec/model/prior-spec";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import { priorSpecUnavailableStatus } from "@/shared/config/g2b-prior-spec";
import { postG2b } from "./request";
import { collectAttachments } from "./attachments";
import { collectOnce } from "./collect-once";
import { trackCollectionAttempt, trackCollectionLookup } from "./collection-attempt";

// 나라장터 화면에서도 상세를 열 수 없었던 사례의 응답 문구다.
const unavailableDetailErrorMessage = "조회하는데 에러가 발생하였습니다.";

// 조회 불가 응답은 요청 번호와 함께 반환해 공고 수집과 직접 수집에서 안내한다.
type PriorSpecUnavailable = { number: string; status: typeof priorSpecUnavailableStatus };

/**
 * 사전규격 상세와 공개 첨부를 저장한다. 일반 수집은 저장된 본문이 있으면 미수집 첨부만 조회한다.
 * 일반 첨부 조회 오류에서는 새 본문을 보존하며, 점검이 확인되면 본문과 첨부의 저장을 보류한다.
 * @param number 사전규격등록번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 다시 조회하고 성공 시 교체한다.
 * @returns 조회 불가 응답이면 요청 번호와 상태를 반환한다. 저장 또는 기존 자료 재사용이 끝나면 반환값이 없다.
 * @throws 점검, 세션 발급, 조회 불가로 분류되지 않은 상세 오류, 첨부 조회·검증 또는 저장소 접근 실패.
 */
export async function collectPriorSpec(number: string, force = false): Promise<PriorSpecUnavailable | undefined> {
  const repository = getG2bRepository();
  return collectOnce(`prior-spec:${number}`, force, async () => {
    let spec: PriorSpec | null = force
      ? null
      : await trackCollectionLookup({ section: "prior-specs", number }, "사전규격", () => repository.findPriorSpec(number));
    const needsDetail = !spec;
    // 첨부 그룹이 없는 사전규격은 첨부 조회 없이 수집 완료로 취급한다.
    if (
      spec &&
      (spec.attachments ||
        !attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo))
    )
      return;
    return trackCollectionAttempt({ section: "prior-specs", number }, async (recordFailure) => {
      const request = await createG2bSession();
      if (!spec) {
        const collectedAt = new Date().toISOString();
        let payload: Awaited<ReturnType<typeof postG2b>>;
        try {
          payload = await postG2b(
            "/pn/pnz/pnza/BfSpec/selectBfSpec.do",
            "FIUA027_01_wframe_popupCnts_bfSpecWfrm_sbmSrch",
            {
              dlParamM: {
                bfSpecRegNo: number,
                prcmBsneSeCd: "",
                opnnSqno: "",
                jobType: "",
              },
            },
            request,
          );
        } catch (error) {
          const { step, response } = describeCollectionError(error);
          if (step === "HTTP 응답" && response?.status === 500 &&
              String(response.errorCode) === "-1" && response.errorMessage === unavailableDetailErrorMessage) {
            return { number, status: priorSpecUnavailableStatus } satisfies PriorSpecUnavailable;
          }
          throw error;
        }
        if (payload?.dlBfSpecM?.bfSpecRegNo !== number) {
          throw collectionValidationError("요청한 사전규격의 상세 응답을 받지 못했습니다.", "dlBfSpecM.bfSpecRegNo",
            { number }, { number: payload?.dlBfSpecM?.bfSpecRegNo });
        }
        spec = { number, collectedAt, payload };
      }
      const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
      const attachments = group
        ? await collectAttachments(group, "prior-spec", request).catch(async (error: unknown) => {
            if (!findMaintenance(error) && !force && needsDetail) {
              try {
                await collectionAsyncStep("저장소 사전규격 부분 저장", () => repository.savePriorSpec(spec));
              } catch (saveError) {
                recordFailure(error);
                throw saveError;
              }
            }
            throw error;
          })
        : undefined;
      if (force || needsDetail || attachments)
        await collectionAsyncStep("저장소 사전규격 저장", () => repository.savePriorSpec({ ...spec, attachments }));
    });
  });
}

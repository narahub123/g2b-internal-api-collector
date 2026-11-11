import { getG2bRepository } from "@/server/g2b/repository";
import type { PriorSpec } from "@/entities/prior-spec/model/prior-spec";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import { postG2b } from "./request";
import { collectAttachments } from "./attachments";
import { collectOnce } from "./collect-once";
import { trackCollectionAttempt } from "./collection-attempt";

/**
 * 사전규격 상세와 공개 첨부를 저장한다. 일반 수집은 저장된 본문이 있으면 미수집 첨부만 조회한다.
 * 일반 첨부 조회 오류에서는 새 본문을 보존하며, 점검이 확인되면 본문과 첨부의 저장을 보류한다.
 * @param number 사전규격등록번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 다시 조회하고 성공 시 교체한다.
 * @throws 점검, 세션 발급, 상세·첨부 조회 또는 검증, 저장소 접근이 실패한 경우.
 */
export async function collectPriorSpec(number: string, force = false) {
  const repository = getG2bRepository();
  return collectOnce(`prior-spec:${number}`, force, async () => {
    let spec: PriorSpec | null = force
      ? null
      : repository.findPriorSpec(number);
    const needsDetail = !spec;
    // 첨부 그룹이 없는 사전규격은 첨부 조회 없이 수집 완료로 취급한다.
    if (
      spec &&
      (spec.attachments ||
        !attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo))
    )
      return;
    return trackCollectionAttempt({ section: "prior-specs", number }, async () => {
      const request = await createG2bSession();
      if (!spec) {
        const collectedAt = new Date().toISOString();
        const payload = await postG2b(
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
        if (payload?.dlBfSpecM?.bfSpecRegNo !== number) {
          throw new Error("요청한 사전규격의 상세 응답을 받지 못했습니다.");
        }
        spec = { number, collectedAt, payload };
      }
      const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
      const attachments = group
        ? await collectAttachments(group, "prior-spec", request).catch((error: unknown) => {
            if (!findMaintenance(error) && !force && needsDetail) repository.savePriorSpec(spec);
            throw error;
          })
        : undefined;
      if (force || needsDetail || attachments)
        repository.savePriorSpec({ ...spec, attachments });
    });
  });
}

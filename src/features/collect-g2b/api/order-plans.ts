import { collectionStep, collectionValidationError, describeCollectionError } from "@/shared/api/g2b/collection-diagnostic";
import { getG2bRepository } from "@/server/g2b/repository";
import { orderPlanAttachmentGroup } from "@/entities/order-plan/model/order-plan";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { orderPlanUnprocessableStatus } from "@/shared/config/g2b-order-plan";
import { postG2b } from "./request";
import { collectAttachments } from "./attachments";
import { collectOnce } from "./collect-once";
import { trackCollectionAttempt, trackCollectionLookup } from "./collection-attempt";

// 공고의 조회 번호와 달라도 차세대 나라장터 발주계획번호 형식이면 상세 응답의 번호를 사용한다.
const orderPlanNumberPattern = /^R[0-9]{2}DD[0-9]{8}$/;

// 나라장터는 사용할 수 없는 발주계획 참조에 이 문구와 함께 HTTP 422를 반환한다.
const missingOrderPlanErrorMessage = "발주계획정보가 존재하지 않습니다.";

type CollectedOrderPlan = {
  number: string;
  status?: undefined;
  attachmentFailure?: { reason: unknown };
} | {
  number: string;
  status: typeof orderPlanUnprocessableStatus;
  attachmentFailure?: undefined;
};

/**
 * 발주계획 본문과 첨부 목록을 수집한다. 일반 수집은 저장된 본문을 재사용하고 누락된 첨부만 보충한다.
 * 새 본문의 첨부 조회가 일반 오류로 끝나면 본문을 남겨 다음 수집에서 첨부만 조회한다. 점검이면 저장을 보류한다.
 * @param number 발주계획번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 모두 다시 조회하고 성공 시 교체한다.
 * @param options.fromNotice 공고에서 연결된 계획을 수집할 때 유효한 응답 번호를 저장 키로 허용한다.
 * @returns 저장된 번호와 선택적 첨부 오류. 상세가 미존재로 확인되면 요청 번호와 HTTP 422에 해당하는 상태를 반환한다.
 * @throws 점검, 세션 발급, 미존재 외 상세 조회 오류, 검증·저장소 오류 및 직접 수집의 첨부 오류.
 */
export async function collectOrderPlan(
  number: string,
  force = false,
  { fromNotice = false }: { fromNotice?: boolean } = {},
): Promise<CollectedOrderPlan> {
  const repository = getG2bRepository();
  const allowResponseNumber = fromNotice && !force;

  return collectOnce(`order-plan:${allowResponseNumber ? "notice:" : ""}${number}`, force, async () => {
    let plan = force ? null : await trackCollectionLookup({ section: "order-plans", number }, "발주계획", () => repository.findOrderPlan(number));
    let needsSave = !plan;
    // 저장된 본문이 있고 첨부 수집이 끝났거나 첨부 그룹이 없으면 중복 요청을 피한다.
    if (plan && (plan.attachments || !orderPlanAttachmentGroup(plan))) return { number: plan.number };
    return trackCollectionAttempt({ section: "order-plans", number }, async (recordFailure) => {
      const request = await createG2bSession();
      if (!plan) {
        const collectedAt = new Date().toISOString();
        let payload: Awaited<ReturnType<typeof postG2b>>;
        try {
          payload = await postG2b(
            "/pr/prp/prpa/OderPlan/selectOderPlan.do",
            "FIUA027_01_wframe_popupCnts_orderPlanWfrm_sbmSrch",
            { dlParamM: { oderPlanNo: number, resultCnt: "" } },
            request,
          );
        } catch (error) {
          const { step, response } = describeCollectionError(error);
          if (step === "HTTP 응답" && response?.status === 422 && response.errorMessage === missingOrderPlanErrorMessage) {
            return { number, status: orderPlanUnprocessableStatus };
          }
          throw error;
        }
        const responseNumber = payload?.dlOderPlanM?.oderPlanNo;
        if (responseNumber !== number &&
            !(allowResponseNumber && typeof responseNumber === "string" && orderPlanNumberPattern.test(responseNumber))) {
          throw collectionValidationError("요청한 발주계획의 상세 응답을 받지 못했습니다.", "dlOderPlanM.oderPlanNo",
            { number }, { number: responseNumber });
        }
        if (responseNumber !== number) {
          // 여러 공고가 같은 응답 번호로 연결될 수 있으므로 이미 저장한 본문과 첨부를 재사용한다.
          plan = collectionStep("SQLite 응답 발주계획 조회", () => repository.findOrderPlan(responseNumber));
          needsSave = !plan;
        }
        plan ??= { number: responseNumber, collectedAt, payload };
      }
      const savedNumber = plan.number;
      const group = orderPlanAttachmentGroup(plan);
      if (!needsSave && (plan.attachments || !group)) return { number: savedNumber };
      let attachments;
      if (group) {
        try {
          attachments = await collectAttachments(group, "order-plan", request);
        } catch (error) {
          // 일반 오류일 때만 새 본문을 남겨 다음 수집에서 첨부 조회를 이어간다.
          if (!findMaintenance(error) && !force) {
            if (needsSave) {
              try {
                collectionStep("SQLite 발주계획 부분 저장", () => repository.saveOrderPlan(plan));
              } catch (saveError) {
                recordFailure(error);
                throw saveError;
              }
            }
            if (allowResponseNumber) {
              recordFailure(error);
              return { number: savedNumber, attachmentFailure: { reason: error } };
            }
          }
          throw error;
        }
      }
      if (force) collectionStep("SQLite 발주계획 저장", () => repository.replaceOrderPlan({ ...plan, attachments }));
      else if (needsSave) collectionStep("SQLite 발주계획 저장", () => repository.saveOrderPlan({ ...plan, attachments }));
      else if (attachments)
        collectionStep("SQLite 발주계획 첨부 저장", () => repository.saveOrderPlanAttachments(
          savedNumber,
          plan.collectedAt,
          attachments,
        ));
      return { number: savedNumber };
    });
  });
}

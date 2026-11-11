import { getG2bRepository } from "@/server/g2b/repository";
import { orderPlanAttachmentGroup } from "@/entities/order-plan/model/order-plan";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { postG2b } from "./request";
import { collectAttachments } from "./attachments";
import { collectOnce } from "./collect-once";

/**
 * 발주계획 본문과 첨부 목록을 수집한다. 일반 수집은 저장된 본문을 재사용하고 누락된 첨부만 보충한다.
 * 새 본문의 첨부 조회가 일반 오류로 끝나면 본문을 남겨 다음 수집에서 첨부만 조회한다. 점검이면 저장을 보류한다.
 * @param number 발주계획번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 모두 다시 조회하고 성공 시 교체한다.
 * @throws 점검, 세션 발급, 상세·첨부 조회 또는 검증, 저장소 접근이 실패한 경우.
 */
export async function collectOrderPlan(number: string, force = false) {
  const repository = getG2bRepository();

  return collectOnce(`order-plan:${number}`, force, async () => {
    let plan = force ? null : repository.findOrderPlan(number);
    const needsDetail = !plan;
    // 저장된 본문이 있고 첨부 수집이 끝났거나 첨부 그룹이 없으면 중복 요청을 피한다.
    if (plan && (plan.attachments || !orderPlanAttachmentGroup(plan))) return;
    const request = await createG2bSession();
    if (!plan) {
      const collectedAt = new Date().toISOString();
      const payload = await postG2b(
        "/pr/prp/prpa/OderPlan/selectOderPlan.do",
        "FIUA027_01_wframe_popupCnts_orderPlanWfrm_sbmSrch",
        { dlParamM: { oderPlanNo: number, resultCnt: "" } },
        request,
      );
      if (payload?.dlOderPlanM?.oderPlanNo !== number) {
        throw new Error("요청한 발주계획의 상세 응답을 받지 못했습니다.");
      }
      plan = { number, collectedAt, payload };
    }
    const group = orderPlanAttachmentGroup(plan);
    const attachments = group
      ? await collectAttachments(group, "order-plan", request).catch((error: unknown) => {
          // 일반 오류일 때만 새 본문을 남겨 다음 수집에서 첨부 조회를 이어간다.
          if (!findMaintenance(error) && !force && needsDetail) repository.saveOrderPlan(plan);
          throw error;
        })
      : undefined;
    if (force) repository.replaceOrderPlan({ ...plan, attachments });
    else if (needsDetail) repository.saveOrderPlan({ ...plan, attachments });
    else if (attachments)
      repository.saveOrderPlanAttachments(
        number,
        plan.collectedAt,
        attachments,
      );
  });
}

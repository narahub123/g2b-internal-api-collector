import { dispatchG2bWorkflow } from "@/server/g2b/github-workflow";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openAttachmentDispatch } from "@/server/g2b/repository/attachment-dispatch";

/** 자동 호출을 예약한 뒤 워크플로에 전달한다. 호출 실패 시 첨부 작업은 다음 복구 요청에서 처리한다. */
export async function dispatchPendingAttachments(
  dispatch = () => dispatchG2bWorkflow("attachment-processing.yml"),
) {
  const reservation = openAttachmentDispatch(getG2bDatabase());
  const token = await reservation.reserve();
  if (!token) return false;
  try {
    await dispatch();
  } catch (error) {
    try {
      await reservation.finish(token, false);
    } catch (releaseError) {
      // 예약을 풀 수 없으면 DB 시각 기준 만료 후 복구한다.
      console.error("[첨부 자동 실행 예약 해제]", releaseError);
    }
    throw error;
  }
  await reservation.finish(token, true);
  return true;
}

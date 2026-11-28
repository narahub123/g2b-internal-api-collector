import { dispatchG2bWorkflow } from "@/server/g2b/github-workflow";
import { getDictionaryQueue } from "./dictionary-queue";

/**
 * 사전이 실행 가능한 경우에만 GitHub 워커 실행을 요청한다.
 * @returns 워크플로 요청을 접수했는지 여부.
 * @throws 호출이 실패하면 예약을 해제하고 오류를 전달한다.
 */
export async function dispatchDictionaries() {
  const queue = getDictionaryQueue();
  const token = await queue.reserve();
  if (!token) return false;
  try {
    await dispatchG2bWorkflow("dictionary-collection.yml");
    return true;
  } catch (error) {
    await queue.releaseDispatch(token);
    throw error;
  }
}

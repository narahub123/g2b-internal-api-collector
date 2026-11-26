import { unstable_cache } from "next/cache";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openBusinessInformation } from "@/server/g2b/repository/business-information";

/**
 * 권한 조회에서 확인한 사업자 버전의 업무 행을 DB에서 가져온다.
 * @param id 권한이 확인된 사업자의 내부 ID.
 * @param version 해당 요청에서 확인한 업무 데이터 버전.
 * @returns 사용자 및 수집 상태를 제외한 업무 행.
 * @throws 일치하는 버전이 없거나 조회가 실패하면 결과를 캐시에 기록하지 않는다.
 */
async function readBusinessItems(id: number, version: string) {
  // 버전 일치 확인과 업무 조회를 저장소의 단일 SQL에서 수행한다.
  return openBusinessInformation(getG2bDatabase()).itemsForVersion(id, version);
}

/** 권한을 통과한 사용자가 같은 사업자 ID와 버전의 업무 행을 공유한다. */
export const readCachedBusinessItems = unstable_cache(readBusinessItems, ["business-detail-items-v1"]);

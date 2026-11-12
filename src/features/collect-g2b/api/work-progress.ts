import type { NoticeKey } from "@/entities/notice";
import { postG2b } from "./request";
import { collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";

const workProgressMenu =
  '{"menuNo":"13677","menuCangVal":"FIUA009_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"05665"}';

// 업무 진행과 계약 상세 API가 공유하는 통합검색 경로.
export const unifiedSearchPath = "/fi/fiu/fiua/UntySrch";

/**
 * 공고번호와 차수로 업무 진행 내역을 조회해 계약·계약요청 연결 후보를 얻는다.
 *
 * @param key 공고번호와 공고차수.
 * @returns 업무 진행 내역 목록.
 * @throws 응답의 업무 진행 목록이 배열이 아닌 경우.
 */
export async function fetchWorkProgress({
  number,
  revision,
}: NoticeKey): Promise<Record<string, unknown>[]> {
  const result = await postG2b(
    `${unifiedSearchPath}/srchWorkPrgs.do`,
    "sbmWorkPrgs",
    {
      dlWorkParamM: {
        workSrchSeCd: "BK",
        workBizNo: number,
        workBizOrd: revision,
      },
    },
    fetch,
    workProgressMenu,
  );
  if (!Array.isArray(result.dlWorkPrgsL))
    throw collectionValidationError("나라장터 업무 진행 응답 형식이 올바르지 않습니다.", "dlWorkPrgsL");
  return result.dlWorkPrgsL;
}

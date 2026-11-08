export type OrderPlan = {
  number: string;
  collectedAt: string;
  payload: Record<string, unknown> & { dlOderPlanM: Record<string, unknown> };
  attachments?: Record<string, unknown>;
};

/**
 * 발주계획에 연결된 통합첨부파일번호를 반환한다.
 * @param plan 저장된 발주계획.
 * @returns 유효한 첨부 그룹 ID 또는 undefined.
 */
export function orderPlanAttachmentGroup(plan: OrderPlan) {
  const value = plan.payload.dlOderPlanM.oderPlanUntyAtchFileNo;
  if (typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.trim())) {
    return value.trim();
  }
}

/**
 * 발주계획의 공개 첨부를 다운로드 순번과 함께 반환한다.
 * @param plan 저장된 발주계획과 첨부 목록.
 * @returns 해당 계획의 첨부 그룹에서 공개 표시가 허용된 파일 목록.
 */
export function orderPlanFiles(plan: OrderPlan) {
  const group = orderPlanAttachmentGroup(plan);
  const rows = plan.attachments?.dlUntyAtchFileL;
  if (!group || !Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    const filename = row?.orgnlAtchFileNm;
    const seq = String(row?.atchFileSqno);
    if (row?.untyAtchFileNo !== group || row.scrnIndtYn !== 'Y' ||
        typeof filename !== 'string' || !filename.trim() || !/^[1-9]\d*$/.test(seq)) return [];
    return [{ filename, seq, downloadable: row.dwnldPrmsYn !== 'N' && !/[\x00-\x1f\x7f]/.test(filename),
      businessCode: typeof row.bsneClsfCd === 'string' ? row.bsneClsfCd : '업130020' }];
  });
}

/**
 * 공고 상세에서 나라장터 발주계획 조회에 사용할 번호를 찾는다.
 * @param payload 수집한 공고 상세 응답.
 * @returns 통합 발주계획번호 또는 기존 상세에 기록된 발주계획번호. 둘 다 비어 있으면 undefined.
 */
export function getNoticeOrderPlanNumber(payload: Record<string, unknown>) {
  const detail = payload.dmItemMap as Record<string, unknown> | undefined;
  for (const number of [detail?.oderPlanUntyNo, detail?.oderPlanNo]) {
    if (typeof number === 'string' && /^[A-Z0-9-]{1,30}$/.test(number.trim())) {
      return number.trim();
    }
  }
}

/**
 * 저장된 발주계획의 상세 경로를 만든다.
 * @param number 나라장터 발주계획번호.
 * @returns 앱의 발주계획 상세 경로.
 */
export function orderPlanPath(number: string) {
  return `/order-plans/${encodeURIComponent(number)}`;
}

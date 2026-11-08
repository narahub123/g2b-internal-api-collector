export const attachmentSources = {
  notice: { bsnePath: 'PNPE', tblNm: 'PBANC_BID_PBANC', colNm: 'ITEM_PBANC_UNTY_ATCH_FILE_NO' },
  'order-plan': { bsnePath: 'PRPA', tblNm: 'DMND_ODER_PLAN', colNm: 'ODER_PLAN_UNTY_ATCH_FILE_NO' },
  'prior-spec': { bsnePath: 'PRVA', tblNm: 'PBANC_BF_SPEC', colNm: 'UNTY_ATCH_FILE_NO' },
} as const;

/** @param value 상세 응답의 첨부 그룹 값. @returns 유효한 통합첨부파일번호. */
export function attachmentGroup(value: unknown) {
  if (typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.trim())) {
    return value.trim();
  }
}

/**
 * 첨부 응답에서 해당 그룹의 공개 파일과 다운로드 가능 여부를 읽는다.
 * @param group 상세 응답의 통합첨부파일번호.
 * @param attachments 저장된 첨부 목록 응답.
 * @returns 공개 첨부 목록.
 */
export function publicAttachmentFiles(group?: string, attachments?: Record<string, unknown>) {
  const rows = attachments?.dlUntyAtchFileL;
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

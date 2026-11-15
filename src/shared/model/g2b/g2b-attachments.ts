import { getNoticeAttachmentKindName } from "./attachment-kind-codes";

export const attachmentSources = {
  notice: {
    bsnePath: "PNPE",
    tblNm: "PBANC_BID_PBANC",
    colNm: "ITEM_PBANC_UNTY_ATCH_FILE_NO",
  },
  "etc-notice": {
    bsnePath: "PNPE",
    tblNm: "PBANC_UNTY_BID_PBANC",
    colNm: "UNTY_ATCH_FILE_NO",
  },
  // 민간공고 파일 UDC가 사용하는 누리장터 첨부 경로다.
  "private-notice": { bsnePath: "a", tblNm: "c", colNm: "d" },
  "notice-post": {
    bsnePath: "ntcbbs",
    tblNm: "PBASP_PST",
    colNm: "UNTY_ATCH_FILE_NO",
  },
  "base-amount-adjustment": {
    bsnePath: "PEXM",
    tblNm: "PBANC_BID_PBANC",
    colNm: "PBANC_SPEC_UNTY_ATCH_FILE_NO",
  },
  "order-plan": {
    bsnePath: "PRPA",
    tblNm: "DMND_ODER_PLAN",
    colNm: "ODER_PLAN_UNTY_ATCH_FILE_NO",
  },
  "prior-spec": {
    bsnePath: "PRVA",
    tblNm: "PBANC_BF_SPEC",
    colNm: "UNTY_ATCH_FILE_NO",
  },
} as const;

/** @param value 상세 응답의 첨부 그룹 값. @returns 유효한 통합첨부파일번호. */
export function attachmentGroup(value: unknown) {
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.trim())
  ) {
    return value.trim();
  }
}

/**
 * 첨부 응답에서 해당 그룹의 공개 파일과 다운로드 가능 여부를 읽는다.
 * @param group 상세 응답의 통합첨부파일번호.
 * @param attachments 저장된 첨부 목록 응답.
 * @param scope 첨부를 소유한 상세 자료 유형.
 * @returns 공개 첨부 목록. 입찰공고는 문서구분을 추가로 제공한다.
 */
export function publicAttachmentFiles(
  group: string | undefined,
  attachments: Record<string, unknown> | undefined,
  scope: keyof typeof attachmentSources,
) {
  const rows = attachments?.dlUntyAtchFileL;
  if (!group || !Array.isArray(rows)) return [];
  const requiresExplicitPermission = scope === "notice-post" || scope === "base-amount-adjustment";
  return rows.flatMap((row) => {
    const filename = row?.orgnlAtchFileNm;
    const seq = String(row?.atchFileSqno);
    // 사전규격 공개 목록은 일부 기존 첨부에서 표시 플래그를 null로 반환한다.
    // 입찰공고에는 이 예외를 적용하지 않는다.
    const visible =
      row?.scrnIndtYn === "Y" ||
      (scope === "prior-spec" && row?.scrnIndtYn === null);
    if (
      row?.untyAtchFileNo !== group ||
      !visible ||
      typeof filename !== "string" ||
      !filename.trim() ||
      !/^[1-9]\d*$/.test(seq)
    )
      return [];
    return [
      {
        filename,
        seq,
        // 입찰공고 파일첨부 섹션에만 문서구분 명칭을 표시한다.
        // 다른 업무의 첨부 유형 코드는 별도의 공통 코드 그룹을 사용할 수 있다.
        documentType:
          scope === "notice" && typeof row.atchFileKndCd === "string"
            ? getNoticeAttachmentKindName(row.atchFileKndCd)
            : undefined,
        // 원본 파일 크기(바이트). 화면에서 단위를 변환해 표시한다.
        // API가 숫자/숫자 문자열을 반환할 수 있으므로 원본 값을 유지한다.
        fileSize: row.fileSz ?? undefined,
        downloadable:
          (requiresExplicitPermission ? row.dwnldPrmsYn === "Y" : row.dwnldPrmsYn !== "N") &&
          !/[\x00-\x1f\x7f]/.test(filename),
        businessCode:
          typeof row.bsneClsfCd === "string" ? row.bsneClsfCd : scope === "base-amount-adjustment" ? "업130027" : "업130020",
      },
    ];
  });
}

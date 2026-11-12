import { openingResultQuery } from "@/entities/opening-result/model/opening-result";
import type { Notice } from "./types";
import { etcNoticeDetail, noticeAttachmentGroup } from "./notice-detail";
import { publicAttachmentFiles } from "@/shared/model/g2b/g2b-attachments";
import { getNoticeOrderPlanNumber } from "@/entities/order-plan/model/order-plan";
import { getNoticePriorSpecNumber } from "@/entities/prior-spec/model/prior-spec";
import { getNoticeAttachmentKindName } from "@/shared/model/g2b/attachment-kind-codes";
import { formatAttachmentFileSize } from "@/shared/model/g2b/attachment-file-size";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import {
  formatG2bDisplayText,
  type G2bDisplayFormat,
} from "@/shared/lib/g2b/g2b-display-format";

type RecordValue = Record<string, unknown>;
type Column = readonly [key: string, label: string];
type Field = readonly [key: string, label?: string, visible?: boolean];

// 연관정보는 일반 필드 외에 관련공고와 계약 목록도 표시하므로 섹션 이름을 공유한다.
export const relatedNoticeSectionTitle = "연관정보";

// ItemBidAnncMngV 화면에서 필드와 표가 나오는 순서다.
// 이 배열은 섹션의 최종 정렬 기준이며, 데이터가 없는 섹션을 강제로 표시하지는 않는다.
const sectionOrder = [
  "공고안내",
  "공고일반",
  "입찰자격",
  "투찰제한-일반",
  "입찰참가자격 및 참가자격등록 안내",
  "입찰진행정보",
  "입찰진행정보 기타",
  "제안발표순서",
  "제안요청정보",
  "협상에의한 계약",
  "규격가격동시/2단계경쟁",
  "복수견적(역경매)",
  "제출서류",
  "가격",
  "기초금액공개",
  "지명업체",
  "기관담당자정보",
  "수요기관담당자정보 목록",
  relatedNoticeSectionTitle,
  "구매대상물품",
  "입찰진행현황",
  "파일첨부",
];

// 입찰진행정보 표의 열 정의 순서다.
const schedule = [
  ["subject", "진행명"],
  ["prgNm", "진행방법"],
  ["startDt", "시작일시"],
  ["endDt", "종료일시"],
  ["placNm", "장소"],
] as const;

// 구매대상물품 표의 기본 열 정의다. 자체물품 분류 사용 여부에 따라 열이 추가된다.
const itemColumns = [
  ["no", "No"],
  ["bidClsfNo", "분류"],
  ["dmstUntyGrpNm", "수요기관"],
  ["dtlsPrnmNm", "세부품명"],
  ["dlvgdsTermNody", "납품일수"],
  ["dlvgdsPlacNm", "납품장소"],
  ["prchsDtlItemQty", "수량"],
  ["prchsDtlItemUntValNm", "단위"],
  ["prchsDtlItemUprc", "추정단가(원)"],
  ["dtlsPrnmNo", "세부품명번호"],
  ["itemIdnfNo", "물품식별번호"],
  ["itemDtlSpecCn", "규격"],
  ["dlvgdsTermDt", "납품기한"],
  ["devyCndtNm", "인도조건"],
] as const;

// 수요기관담당자정보 목록의 기본 열 정의다. 평가담당자 여부 열은 조건에 따라 추가된다.
const contactColumns = [
  ["dmstUntyGrpNm", "수요기관"],
  ["deptNm", "부서명"],
  ["picNm", "담당자"],
  ["faxNo", "팩스번호"],
  ["tlphNo", "전화번호"],
] as const;

// 제안요청 문서 종류의 표시 순서를 정의한다.
const proposalKinds = [
  ["첨020196", "예산산출내역서"],
  ["첨020066", "제안요청서"],
  ["첨020109", "기타문서"],
  ["첨020195", "긴급발주사유서"],
  ["첨020197", "대기업참여제한예외사유서"],
] as const;

// 공개 첨부파일만 추리고, 화면 표시용 문서구분 명칭을 추가한다.
// 기존 원본 필드는 보존하므로 다운로드 URL 생성에 영향을 주지 않는다.
function documentRows(documents: Notice["documents"]) {
  const attachmentList = documents?.attachments?.dlUntyAtchFileL;

  if (!Array.isArray(attachmentList)) return [];

  return attachmentList
    .map(record)
    .filter(
      (row) => row.scrnIndtYn === "Y" && displayValue(row.orgnlAtchFileNm),
    )
    .map((row) => ({
      ...row,

      // API의 첨부파일 종류 코드를 문서구분 명칭으로 변환한다.
      documentType:
        typeof row.atchFileKndCd === "string"
          ? getNoticeAttachmentKindName(row.atchFileKndCd)
          : undefined,

      // API 원본 fileSz는 보존하고 표시용 문자열만 추가한다.
      fileSizeText: formatAttachmentFileSize(row.fileSz),
    }));
}

/**
 * 협상계약에서 공개 표시 대상인 제안요청 문서를 반환한다.
 * @param payload 공고 상세 API 응답.
 * @param documents 저장한 문서 API 응답.
 * @returns 화면과 다운로드 라우트에서 사용하는 공개 문서 행.
 */
export function getPublicProposalRows(
  payload: RecordValue,
  documents: Notice["documents"],
) {
  if (record(payload.dmItemMap).scsbdMthdCd !== "낙030005") return [];
  const proposalList = documents?.proposal?.dlUntyAtchFileL;
  const rows = Array.isArray(proposalList) ? proposalList.map(record) : [];
  // 나라장터의 제안요청 표는 기타문서만 같은 분류의 여러 건을 표시한다.
  return proposalKinds.flatMap(([code, kind]) => {
    const matches = rows.filter((row) => row.rfpAtchFileKndCd === code);
    return (code === "첨020109" ? matches : matches.slice(0, 1))
      .filter(
        (row) =>
          row.rfpAtchDocRlsYn === "Y" && displayValue(row.orgnlAtchFileNm),
      )
      .map((row) => ({
        kind,
        orgnlAtchFileNm: row.orgnlAtchFileNm,
        fileNo: displayValue(row.rfpUntyAtchFileNo),
        seq: displayValue(row.rfpAtchFileSqno),
      }));
  });
}

// 빈 문자열은 표시 대상에서 제외하고 숫자는 문자열로 변환한다.
export function displayValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (typeof value === "number") return String(value);
}

// 공고 상세·일정·품목·담당자 API의 표시 키만 지정한다. 식별자와 다운로드 키는 원본을 사용한다.
const fieldFormats: Readonly<Record<string, G2bDisplayFormat>> = {
  pbancPstgDt: "dateTime",
  pbancBfssDt: "dateTime",
  plrlEstmPrcpRegDdlnDt: "dateTime",
  startDt: "dateTime",
  endDt: "dateTime",
  onbsPrnmntDt: "dateTime",
  inptDt: "dateTime",
  dlvgdsTermDt: "date",
  dlvgdsTermNody: "integer",
  prchsDtlItemQty: "decimal",
  prchsDtlItemUprc: "decimal",
  bizAmt: "integer",
  alotBgtAmt: "integer",
  prspPrce: "integer",
  baseAmt: "integer",
  pmcsRtnmEvlcrtAmt: "integer",
  prspAmt: "integer",
  prspRt: "decimal",
  scsbdLwlmRat: "decimal",
  dfrlScrItvlScr: "decimal",
  techAbltEvlRt: "decimal",
  bidPrceEvlRt: "decimal",
  stbltCrtrScr: "decimal",
  minReduRt: "decimal",
  etpsMaxBdngNotm: "integer",
  pbancPicTlphNo: "phone",
  faxNo: "phone",
  tlphNo: "phone",
};

/** 기존 빈값 판정 뒤에 공고 필드의 표시 포맷을 적용한다. */
function displayFieldValue(key: string, value: unknown): string | undefined {
  const text = displayValue(value);
  return text === undefined ? undefined : formatG2bDisplayText(text, fieldFormats[key]);
}

// 객체 형태의 값만 필드 접근에 사용하고 나머지는 빈 객체로 처리한다.
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

// 필드 정의 순서를 유지하되 표시 조건이 거짓이거나 값이 없으면 해당 필드를 제외한다.
function fields(source: RecordValue, definitions: readonly Field[]) {
  return definitions.flatMap(([key, label, visible = true]) => {
    const value = visible ? displayValue(source[key]) : undefined;
    return value === undefined
      ? []
      : [{ label, value: formatG2bDisplayText(value, fieldFormats[key]) }];
  });
}

// 표 열은 정의 순서를 유지하지만 모든 행에서 값이 없는 열은 제외한다.
function table(
  title: string,
  source: unknown,
  columns: readonly Column[],
  linkForRow?: (row: RecordValue) => string | undefined,
  linkColumn = "orgnlAtchFileNm",
) {
  const rows = Array.isArray(source) ? source.map(record) : [];
  const visible = columns.filter(([key]) =>
    rows.some((row) => displayValue(row[key]) !== undefined),
  );
  return {
    title,
    columns: visible.map(([, label]) => label),
    rows: rows
      .map((row) =>
        visible.map(([key]) => ({
          value: displayFieldValue(key, row[key]),
          href: key === linkColumn ? linkForRow?.(row) : undefined,
        })),
      )
      .filter((row) => row.some(({ value }) => value !== undefined)),
  };
}

// 공고 식별자와 파일 순번을 검증한 뒤 일반 첨부파일 다운로드 주소를 만든다.
function attachmentDownloadUrl(detail: RecordValue, attachment: RecordValue) {
  const bidPbancNo = displayValue(detail.bidPbancNo);
  const bidPbancOrd = displayValue(detail.bidPbancOrd)?.padStart(3, "0");
  const prcmBsneSeCd = displayValue(detail.prcmBsneSeCd);
  const fileSeq = displayValue(attachment.atchFileSqno);
  if (
    !bidPbancNo ||
    !/^[A-Z0-9-]{1,30}$/.test(bidPbancNo) ||
    !bidPbancOrd ||
    !/^\d{3}$/.test(bidPbancOrd) ||
    !prcmBsneSeCd ||
    !/^\d{2}$/.test(prcmBsneSeCd) ||
    !fileSeq ||
    !/^[1-9]\d*$/.test(fileSeq) ||
    attachment.dwnldPrmsYn === "N"
  ) {
    return;
  }

  // 일반 첨부 목록의 순번을 공고 다운로드 주소의 fileSeq에 사용한다.
  const url = new URL(
    "https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do",
  );
  url.search = new URLSearchParams({
    bidPbancNo,
    bidPbancOrd,
    fileType: "",
    fileSeq,
    prcmBsneSeCd,
  }).toString();
  return url.href;
}

/**
 * 기존 입찰공고 공개 파일 조건과 다운로드 주소를 유지하면서
 * 공통 AttachmentTable에 전달할 파일 목록을 구성한다.
 */
export function getNoticeAttachmentFiles(
  payload: RecordValue,
  documents?: Notice["documents"],
) {
  const etc = etcNoticeDetail(payload);
  if (etc) {
    // 공통 다운로드 API에는 기타 상세 응답의 BK 번호·차수와 업무구분을 전달한다.
    const downloadKey = {
      bidPbancNo: etc.bidPbancUntyNo,
      bidPbancOrd: etc.bidPbancUntyOrd,
      prcmBsneSeCd: etc.prcmBsneSeCd,
    };
    return publicAttachmentFiles(noticeAttachmentGroup(payload), documents?.attachments, "etc-notice")
      .map((file) => ({
        ...file,
        href: file.downloadable ? attachmentDownloadUrl(downloadKey, { atchFileSqno: file.seq }) : undefined,
      }));
  }
  const detail = record(payload.dmItemMap);
  return documentRows(documents).map((row) => {
    const source: RecordValue = row;
    const href = attachmentDownloadUrl(detail, source);
    return {
      filename: displayValue(source.orgnlAtchFileNm) ?? "",
      seq: String(source.atchFileSqno ?? ""),
      documentType: row.documentType,
      fileSize: source.fileSz,
      downloadable: Boolean(href),
      businessCode:
        typeof source.bsneClsfCd === "string" ? source.bsneClsfCd : "업130020",
      href,
    };
  });
}

/**
 * 공개 대상으로 선별된 제안요청 문서를 공통 AttachmentTable 형식으로 변환한다.
 * 문서 종류별 표시 순서와 공개 조건은 getPublicProposalRows()의 결과를 그대로 따른다.
 * 일반 파일첨부와 달리 제안요청 문서는 별도의 다운로드 경로를 사용한다.
 */
export function getNoticeProposalFiles(
  payload: RecordValue,
  documents: Notice["documents"],
) {
  const detail = record(payload.dmItemMap);

  return getPublicProposalRows(payload, documents).map((row, index) => {
    // 기존 제안요청 문서 다운로드 라우트와 API에서 받은 파일번호·순번을 유지한다.
    const href =
      row.fileNo &&
      row.seq &&
      typeof detail.bidPbancNo === "string" &&
      detail.bidPbancOrd != null
        ? `/api/notices/${encodeURIComponent(detail.bidPbancNo)}/${encodeURIComponent(String(detail.bidPbancOrd).padStart(3, "0"))}/proposal-download?${new URLSearchParams({ fileNo: row.fileNo, seq: row.seq })}`
        : undefined;

    // seq는 테이블 행 식별용이며 다운로드에 사용하는 row.seq와는 별개다.
    // 제안요청정보 API에는 파일크기 정보가 없어 해당 열을 표시하지 않는다.
    return {
      filename: displayValue(row.orgnlAtchFileNm) ?? "",
      seq: String(index),
      documentType: row.kind,
      fileSize: undefined,
      downloadable: Boolean(href),
      businessCode: "업130026",
      href,
    };
  });
}

/** 기타 원본 화면의 고정 필드와 조건부 표시값을 화면 순서대로 구성한다. */
function etcNoticeSections(detail: RecordValue) {
  const kind = displayValue(detail.pbancKndNm);
  const status = displayValue(detail.pbancSttsNm);
  const title = displayValue(detail.bidPbancNm);
  const fee = displayValue(detail.bidFee);
  const related = Array.isArray(detail.relaPbancList)
    ? detail.relaPbancList.flatMap((item) => {
        const { bidPbancUntyNo, bidPbancUntyOrd } = record(item);
        const number = displayValue(bidPbancUntyNo);
        const revision = displayValue(bidPbancUntyOrd);
        return number && revision ? [`${number}-${revision}`] : [];
      })
    : [];
  const values: RecordValue = {
    ...detail,
    kindAndStatus: kind && status ? `${kind}(${status})` : kind ?? status,
    bidPbancNm: title && detail.lastPbancYn !== "Y" ? `${title} (최종 공고가 아닙니다.)` : title,
    bidFee: fee === undefined ? undefined : `${formatG2bDisplayText(fee, "integer")} 원`,
    related: related.join("\n"),
  };
  const fixedFields = (definitions: readonly Field[]) => definitions.map(([key, label]) => ({
    label,
    value: displayFieldValue(key, values[key]) ?? "",
  }));
  return [
    { title: "공고일반", fields: fixedFields([
      ["kindAndStatus", "공고종류"],
      ["pbancPstgDt", "공고일시"],
      ["bidPbancUntyNoOrd", "입찰공고번호-차수"],
      ["ldocNoVal", "참조번호"],
      ["oderInstUntyGrpNm", "공고기관"],
      ["dmstNm", "수요기관"],
      ["bidPbancNm", "공고명"],
      ["bidMthdNm", "입찰방법"],
      ["scsbdMthdNm", "낙찰방법"],
      ["related", "관련공고"],
    ]) },
    { title: "입찰집행", fields: fixedFields([
      ["bidFee", "입찰참가 수수료"],
      ["depoElctPayTrgtYnNm", "보증금 여부"],
      ["onbsPrnmntDtStr", "개찰(입찰)일시"],
      ["jintSyddYnNm", "공동수급 여부"],
      ["onbsPlacNm", "개찰장소"],
    ]) },
    { title: "기타", fields: fixedFields([
      ["rbidPrmsYnNm", "재입찰여부"],
      ["bulkBidQlfcCn", "입찰자격"],
      ["rmrkCn", "비고"],
    ]) },
    { title: "파일첨부", columns: [], rows: [] },
  ];
}

/**
 * 상세 응답에 포함된 관련공고 번호를 원본 순서대로 상세 조회 키로 변환한다.
 * @returns 일반 공고의 유효한 번호와 차수 목록. 기타 공고의 관련공고 목록은 별도 형식을 사용한다.
 */
export function getRelatedNoticeKeys(payload: RecordValue) {
  if (etcNoticeDetail(payload)) return [];
  const value = record(payload.dmItemMap).relaPbancNo;
  // 공고번호 자체에 하이픈이 포함될 수 있으므로 끝의 세 자리를 차수로 분리한다.
  return typeof value === "string"
    ? value.split(",").flatMap((entry) => {
        const match = /^(.+)-(\d{3})$/.exec(entry.trim());
        const number = g2bNumber(match?.[1]);
        return number && match ? [{ number, revision: match[2] }] : [];
      })
    : [];
}

/**
 * 저장한 응답에서 공고 상세 화면에 표시할 항목을 구성한다.
 * @param payload 공고 상세 API의 원본 응답.
 * @param documents 문서 API의 원본 응답. 이전에 저장한 공고에는 없을 수 있다.
 * @param openingResultPath 연결된 개찰결과의 주소를 만든다. 주소가 없으면 표에는 원래 값만 표시한다.
 * @param hasContractLinks 연결된 계약요청 또는 계약현황이 있으면 관련 공고 정보 섹션을 표시한다.
 * @returns 원본 화면 순서대로 배열한 필드 및 표 섹션.
 */
export function getNoticeDisplay(
  payload: RecordValue,
  documents: Notice["documents"],
  openingResultPath: (key: { number: string; revision: string }) => string | undefined,
  hasContractLinks = false,
) {
  const etc = etcNoticeDetail(payload);
  if (etc) return etcNoticeSections(etc);
  // 공고 기본정보·안내정보·평가정보를 각각 원본 응답에서 분리한다.
  const detail = record(payload.dmItemMap);
  const guide = record(payload.dmItemGuidMap);
  const evaluation = record(payload.dmEvlStepMap);
  const relatedNotices = getRelatedNoticeKeys(payload);
  // 이하 조건들은 원본 화면의 필드 및 표 표시 여부를 판단하는 데 사용한다.
  const standard = detail.stdPbancDocAplcnYn === "Y";
  const goods = detail.prcmBsneSeCd === "01";
  const services = detail.prcmBsneSeCd === "03";
  const own = detail.prcmMthoSeCd === "조020002";
  const negotiated = detail.scsbdMthdCd === "낙030005";
  const staged =
    detail.scsbdMthdCd === "낙030002" || detail.scsbdMthdCd === "낙030003";
  const showEvaluator = (negotiated || staged) && !own;
  const regionLimited = detail.rgnLmtYn === "Y";
  const licenseLimited = detail.lcnsLmtYn === "Y";
  const internalItems = detail.iritemClsfNoUseYn === "Y";
  // 평가담당자 표시 조건이 충족되면 담당자 여부를 화면용 문자열로 변환한다.
  const contacts =
    showEvaluator && Array.isArray(payload.dmItemList2)
      ? payload.dmItemList2.map((value) => {
          const contact = record(value);
          return {
            ...contact,
            evlPicYn: contact.evlPicYn === "Y" ? "예" : "아니오",
          };
        })
      : payload.dmItemList2;
  // 원본은 자체조달 일반용역에서만 현장설명회 행과 참가 제한을 노출한다.
  // 현장설명회 관련 필드는 자체조달 일반용역에서만 표시한다.
  const showBriefing = services && own;
  const showPresentationDetails =
    negotiated &&
    evaluation.evlDocSbmsnElctHdwrSeCd === "전010001" &&
    detail.prsntnYn === "Y" &&
    evaluation.evlSysUtztnYn === "Y";
  const officerName = displayValue(detail.pbancPicNm);
  const officerPhone = displayFieldValue("pbancPicTlphNo", detail.pbancPicTlphNo);
  const officer =
    officerName && officerPhone
      ? `${officerName} ( ☎ ${officerPhone} )`
      : (officerName ?? officerPhone);
  // 업종별 지분율은 투찰제한-일반 섹션에 포함되는 중첩 표다.
  const licenseShares = table(
    "업종별 지분율",
    licenseLimited ? payload.dmItemLmtList3 : undefined,
    [
      ["no", "No"],
      ["lmtGupSqno", "그룹"],
      ["bidLmtUntyNm", "업종"],
      ["prspAmt", "금액(원)"],
      ["prspRt", "비율(%)"],
    ],
  );

  // 일반 필드 섹션을 구성한다. 여기의 선언 순서와 최종 화면 순서는 별개다.
  const groups = [
    {
      title: "공고일반",
      fields: [
        ...fields(detail, [
          ["pbancKndNm", "공고종류"],
          ["pbancPstgDt", "게시일시"],
          ["bidPbancText", "입찰공고번호"],
          ["usrDocNoVal", "참조번호"],
          ["bidPbancNm", "공고명"],
          ["inspInstSeNm", "검사", !own],
          ["igiInspInstSeNm", "검수", !own],
          ["bidMthdNm", "입찰방식"],
          ["scsbdMthdNm", "낙찰방법"],
          [
            "scsbdMthdDtlsNm",
            "낙찰방법 세부기준",
            /^[RT]/.test(String(detail.bidPbancNo ?? "")),
          ],
          ["scsbdLwlmRat", "낙찰하한율", Number(detail.scsbdLwlmRat) > 0],
        ]),

        // 낙찰방법 안내: 원본 JS의 grpScsbdMthd 위치
        ...fields(guide, [["bulkPbancScsbdMthdCn", " ", standard]]),

        ...fields(detail, [
          [
            "dfrlScrItvlScr",
            "차등점수제 순위간 점수차",
            detail.dfrlScrAplcnYn === "Y",
          ],
          [
            "dfrlScrEvlcrtSeNm",
            "차등점수제 순위간 점수차 부여기준",
            detail.dfrlScrAplcnYn === "Y",
          ],
          [
            "pmcsRtnmEvlcrtAmt",
            "원가절감의 적정성평가 기준금액",
            detail.pmcsRtnmEvlTrgtYn === "Y",
          ],
          ["stdCtrtMthdNm", "계약방법"],
          ["ctrtTyNm", "계약구분"],
          ["dmstcOvrsSeNm", "국제입찰구분"],
          ["grnteCrdrNm", "채권자명"],
          ["jintCtrtCmnMthoNm", "공동수급협정서 제출 및 구성방식"],
          ["wtoBidRsnNm", "국내/국제입찰사유"],
          ["rbidPrmsYnNm", "재입찰여부"],
          ["samePrceBidAtmtDrawYnNm", "동입찰낙찰자 자동추첨프로그램"],
          ["rschDvlpItemYnNm", "연구개발물품 여부", !services],
          ["prttnDlvgdsPsbltyYnNm", "분할납품가능여부", !own],
          ["fctrRspbText", "하자담보기간", !own],
          ["fctrRspbRmrkCn", "하자담보비고내용", !own],
          ["pbancBfssPlacNm", "현장설명회장소", showBriefing],
          ["pbancBfssDt", "현장설명회일시", showBriefing],
          ["wtoItmltNm", "WTO 품목번호", services],
          ["sckrAplcnYnNm", "하도급지킴이 적용 여부", services],
        ]),

        // 원본 grpEtc는 표준공고문일 때만 표시
        ...fields(detail, [["pbancEtcCn", "공고일반기타", standard]]),
      ],
    },
    {
      title: "공고안내",
      fields: fields(guide, [["bulkPbancGuidCn", undefined, standard]]),
    },
    {
      title: "입찰자격",
      fields: fields(detail, [
        ["prfmncLmtYnNm", "실적제한 여부"],
        ["mnftrItemLmtYnNm", "제조 여부"],
        ["bdngAmtRangLmtYnNm", "투찰금액상한 제한여부", !own],
        ["qttyAlotSeNm", "물량배정여부", !own],
        ["elpdtItemCertTyCdLstNm", "중소기업우선구매 대상여부", !own],
        ["smrlCmptItemYnNm", "중기간경쟁제품여부", !own],
        ["etpmDsgnCrfcNo", "우수제품지정번호", !own],
        ["dgtnBizYnNm", "정보화사업여부", !own],
        ["infoLeakPrhbTrgtYnNm", "정보누출금지 대상여부", !own],
        ["lrcoPtcpLmtExcpYnNm", "대기업SW사업자 참여제한 예외적용여부", !own],
        ["lrcoPtcpLmtExcpRsnNm", "예외적용사유", !own],
      ]),
    },
    {
      title: "투찰제한-일반",
      nestedTable: licenseShares.rows.length ? licenseShares : undefined,
      fields: fields(detail, [
        ["rgnLmtYnNm", "지역제한"],
        ["rgnLmtCn", "참가가능지역", regionLimited],
        ["rgnLmtGuidCn", " ", regionLimited],
        ["lcnsLmtYnNm", "업종제한"],
        ["intpLmtCn", "업종제한사항", licenseLimited],
        ["bidPrcpLmtYnNm", "현장설명제한여부", showBriefing],
        ["itemClsfBdngLmtAtrbNm", "물품분류제한여부", !showBriefing],
        ["mnftrItemLmtCn", "물품등록구분", !services],
      ]),
    },
    {
      title: "입찰참가자격 및 참가자격등록 안내",
      fields: fields(guide, [["bulkBidPrqfGuidCn", undefined, standard]]),
    },
    {
      title: "입찰진행정보 기타",
      fields: fields(guide, [
        ["bulkBidPrgrsEtcCn", undefined, standard && goods],
      ]),
    },
    {
      title: "제안발표순서",
      fields: [
        ...fields(detail, [["evlMaagSeNm", "제안서평가기관", negotiated]]),

        // 발표순서 확인
        ...(negotiated
          ? [
              {
                label: "발표순서 확인",
                value: "",
                items: [
                  ...(detail.blndEvlAplcnYn === "Y"
                    ? [
                        "계약담당공무원의 평가일정 안내 이 후 나라장터에서 제안발표 순서를 확인하시기 바랍니다.",
                      ]
                    : []),
                  detail.evlMaagSeCd === "주010007"
                    ? "자세한 사항은 입찰 집행관에게 문의하시기 바랍니다."
                    : "자세한 사항은 수요기관 담당자에게 문의하시기 바랍니다.",
                ],
              },
            ]
          : []),

        ...fields(detail, [["prplPrsntn", "제안서발표", negotiated]]),

        // 유의사항
        ...(showPresentationDetails
          ? [
              {
                label: "유의사항",
                value:
                  "사업관리자(발표자)는 평가일 이전까지 나라장터 회원 가입을 하여야 하며, 나라장터 회원 가입을 하지 않은 사업관리자(발표자)는 평가에 참여하실 수 없습니다.",
              },
            ]
          : []),

        ...fields(guide, [
          [
            "bulkPrplPrsntnEtcCn",
            "제안서발표순서 기타",
            standard && negotiated,
          ],
        ]),
      ],
    },
    {
      title: negotiated ? "협상에의한 계약" : "규격가격동시/2단계경쟁",
      fields: [
        ...fields(evaluation, [
          ["evlMaagSeNm", "평가기관", negotiated || staged],
          ["evlSysUtztnYnNm", "평가시스템이용여부", negotiated || staged],
          ["evlPlacNm", "제안서평가장소", negotiated || staged],
        ]),
        ...fields(detail, [
          ["blndEvlAplcnNm", "블라인드평가적용여부", negotiated],
        ]),
        ...fields(evaluation, [
          ["techAbltEvlRt", "기술능력평가비율(%)", negotiated],
          ["bidPrceEvlRt", "입찰가격평가비율(%)", negotiated],
          ["stbltCrtrScr", "적합기준점수", staged],
          ["rfpSbmsnDocTyNm", "제안서필수제출서류설정", negotiated || staged],
        ]),
      ],
    },
    {
      title: "복수견적(역경매)",
      fields:
        detail.scsbdMthdCd === "낙030030"
          ? fields(detail, [
              ["minReduRt", "최소인하비율(%)"],
              ["etpsMaxBdngNotm", "투찰제한횟수"],
              ["atmtExtsTmmn", "자동연장시각"],
              ["plrlEstmPrcpRegDdlnDt", "참가신청마감일시"],
            ])
          : [],
    },
    {
      title: "제출서류",
      fields: fields(guide, [["bulkSbmsnDocCn", undefined, standard]]),
    },
    {
      title: "가격",
      fields: [
        ...fields(detail, [
          ["pnprDcsnMthoNm", "예가방법"],
          ["bizAmt", "사업금액 (추정가격 + 부가세)"],
          ["alotBgtAmt", "배정예산"],
          ["prspPrce", "추정가격"],
        ]),
        ...fields(guide, [
          ["bulkPbancEtcCn", "예정가격결정 및 입찰금액정보 기타", standard],
        ]),
      ],
    },
    {
      title: "기관담당자정보",
      fields: fields({ ...detail, officer }, [
        ["pbancInstUntyGrpNm", "공고기관"],
        ["officer", "공고담당자"],
        ["bidBlffNm", "집행관"],
      ]),
    },
    {
      title: relatedNoticeSectionTitle,
      relatedNotices,
      fields: fields(
        {
          ...detail,
          oderPlanNo: getNoticeOrderPlanNumber(payload),
          bfSpecRegNo: getNoticePriorSpecNumber(payload) ?? detail.bfSpecRegNo,
        },
        [
          ["bfSpecRegNo", "사전규격등록번호"],
          ["bfSpecUndsRsnNm", "사전규격 미공개 사유"],
          ["oderPlanNo", "발주계획번호"],
        ],
      ),
    },
  ].filter(
    (group) =>
      group.fields.length > 0 ||
      group.nestedTable ||
      (group.title === relatedNoticeSectionTitle && (relatedNotices.length > 0 || hasContractLinks)),
  );

  // 일반 첨부파일과 공개 제안요청 문서를 서로 다른 데이터 원본에서 추린다.
  const attachments = documentRows(documents);
  const proposal = getPublicProposalRows(payload, documents);
  const baseAmounts = Array.isArray(payload.dmItemBaseAmtList)
    ? payload.dmItemBaseAmtList.map(record)
    : [];
  const baseAmountPublishedAt = displayFieldValue("inptDt", baseAmounts[0]?.inptDt);
  // 표 섹션을 구성한다. 행이 없는 표는 아래 필터에서 제외한다.
  const tables = [
    table("입찰진행정보", payload.dmItemList1, schedule),
    table(
      "구매대상물품",
      (() => {
        const itemRows =
          services && own
            ? undefined
            : internalItems
              ? payload.dmItrlItemItemList
              : payload.dmItemItemList;

        return Array.isArray(itemRows)
          ? itemRows.map((row, index) => ({
              ...record(row),
              no: index + 1,
            }))
          : undefined;
      })(),
      internalItems
        ? [
            ...itemColumns.slice(0, 4),
            ["iritemClsfNm", "자체물품명"],
            ...itemColumns.slice(4, 12),
            ["iritemClsfNo", "자체물품번호"],
            ...itemColumns.slice(12),
          ]
        : itemColumns,
    ),
    table(
      "수요기관담당자정보 목록",
      contacts,
      showEvaluator
        ? [...contactColumns, ["evlPicYn", "평가담당자여부"]]
        : contactColumns,
    ),
    {
      ...table(
        "기초금액공개",
        detail.pnprDcsnMthoCd === "예050001"
          ? []
          : baseAmounts.map((row, index) => ({
              ...row,
              no: index + 1,
              baseAmountDetail: "기초금액조회",
            })),
        [
          ["no", "No"],
          ["bidClsfNo", "입찰분류"],
          ["baseAmt", "기초금액(원)"],
          ["rmrkCn", "비고"],
          ["baseAmountDetail", "상세보기"],
        ],
      ),
      note: baseAmountPublishedAt
        ? `공개시각 ${baseAmountPublishedAt}`
        : undefined,
    },
    table(
      "지명업체",
      detail.stdCtrtMthdCd === "계030002"
        ? (payload.dmEtpsGrpList as Record<string, unknown>[] | undefined)?.map(
            (row, index) => ({ ...row, no: index + 1 }),
          )
        : undefined,
      [
        ["no", "NO"],
        ["bzmnRegNo", "사업자등록번호"],
        ["etpsUntyGrpNm", "업체명"],
        ["rprsvNm", "대표자명"],
      ],
    ),
    table(
      "입찰진행현황",
      payload.dlBidBasePgstL,
      [
        ["bidPbancNoOrd", "입찰공고번호"],
        ["bidPrgrsOrd", "재입찰번호"],
        ["bidPbancNm", "공고명"],
        ["onbsPrnmntDt", "개찰일시"],
        ["bidPgstNm", "진행현황"],
      ],
      (row) => {
        const query = openingResultQuery(row, detail);
        if (query) return openingResultPath(query);
      },
      "bidPgstNm",
    ),
    table(
      "제안요청정보",
      proposal,
      [
        ["kind", "문서구분"],
        ["orgnlAtchFileNm", "파일명"],
      ],
      ({ fileNo, seq }) => {
        if (
          typeof fileNo !== "string" ||
          typeof seq !== "string" ||
          typeof detail.bidPbancNo !== "string" ||
          detail.bidPbancOrd == null
        )
          return;
        const params = new URLSearchParams({ fileNo, seq });
        return `/api/notices/${encodeURIComponent(detail.bidPbancNo)}/${encodeURIComponent(String(detail.bidPbancOrd).padStart(3, "0"))}/proposal-download?${params}`;
      },
    ),
    table(
      "파일첨부",
      attachments,
      [
        // 나라장터 원본 화면의 열 순서를 따른다.
        ["documentType", "문서구분"],
        ["orgnlAtchFileNm", "파일명"],
        // 변환된 크기를 표시한다.
        ["fileSizeText", "파일크기"],
      ],

      // 기존 다운로드 URL 생성 로직을 그대로 사용한다.
      (attachment) => attachmentDownloadUrl(detail, attachment),
    ),
  ].filter((entry) => entry.rows.length > 0);

  // 필드 섹션과 표 섹션을 제목으로 합쳐 최종 표시 순서를 적용한다.
  const byTitle = new Map(
    [...groups, ...tables].map((section) => [section.title, section]),
  );
  // sectionOrder에 있는 섹션 중 실제로 구성된 섹션만 순서대로 반환한다.
  return sectionOrder.flatMap((title) => {
    const section = byTitle.get(title);
    return section ? [section] : [];
  });
}

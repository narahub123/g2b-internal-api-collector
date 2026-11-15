import {
  attachmentGroup,
  publicAttachmentFiles,
} from "@/shared/model/g2b/g2b-attachments";
import { noticeAttachmentGroup } from "./notice-detail";
import { formatG2bPhone } from "@/shared/lib/g2b-phone";
import {
  formatG2bDisplayDate,
  formatG2bDisplayDateTime,
  formatG2bDisplayNumber,
} from "@/shared/lib/g2b/g2b-display-format";
import { getG2bCommonCodeName } from "@/shared/lib/g2b/common-codes";
import type { Notice } from "./types";
import { noticePostRecord as record } from "./notice-posts";

/** 저장된 상세 응답을 화면에 표시할 때 사용하는 최소 자료 구조. 원본 응답 자체는 변경하지 않는다. */
type Row = Record<string, unknown>;
type Cell = { value: string; href?: string; colSpan?: number };
type Field = Cell & {
  label?: string;
  details?: { label: string; value: string; href?: string }[];
};
type Group = { title: string; fields: Field[]; nestedTable?: Table };
type Table = {
  title: string;
  columns: string[];
  rows: Cell[][];
  note?: string;
};
type Section = Group | Table;
type Column = [
  label: string,
  key: string,
  format?: (value: string, row: Row) => string,
];

/** 응답의 문자열·숫자만 표시 문자열로 변환하며 다른 형식은 빈 문자열로 처리한다. */
function value(input: unknown): string {
  return typeof input === "string" || typeof input === "number"
    ? String(input)
    : "";
}

/** 원본 목록이 배열인 경우에만 화면용 행으로 변환한다. */
function rows(input: unknown): Row[] {
  return Array.isArray(input) ? input.map(record) : [];
}

/** 상세 페이지의 라벨·값 목록을 화면용 그룹으로 구성한다. */
function group(title: string, fields: [string | undefined, unknown][]): Group {
  return {
    title,
    fields: fields.map(([label, input]) => ({ label, value: value(input) })),
  };
}

/** 원본 목록의 행과 지정된 열 정의를 이용해 표시용 표를 구성한다. */
function columnTable(title: string, input: unknown, columns: Column[]): Table {
  return {
    title,
    columns: columns.map(([label]) => label),
    rows: rows(input).map((row, index) =>
      columns.map(([, key, format]) => {
        const raw = key === "#" ? String(index + 1) : value(row[key]);
        return { value: format ? format(raw, row) : raw };
      }),
    ),
  };
}

/** 날짜·시각으로 분리된 응답 필드를 공통 표시 형식으로 합친다. */
function dateTime(row: Row, key: string) {
  const date = value(row[key + "Ymd"]);
  const time = value(row[key + "Hr"]).replace(
    /^(\d{2})(\d{2})(\d{2})$/,
    "$1:$2:$3",
  );
  return [formatG2bDisplayDate(date, "date"), time].filter(Boolean).join(" ");
}

/** 숫자 문자열을 공통 금액 표기 방식으로 변환한다. */
function amount(input: unknown, unit = "") {
  const raw = value(input);
  return raw ? formatG2bDisplayNumber(raw, 0) + unit : "";
}

/** 나라장터 원본 상세 화면으로 이동할 링크를 구성한다. */
function originalHref(menu: string, params: Record<string, string>) {
  return (
    "https://www.g2b.go.kr/link/" +
    menu +
    "/single/?" +
    new URLSearchParams(params)
  );
}

/** 변경·취소 공지의 상세 응답과 공개 첨부를 화면에 표시할 필드로 변환한다. */
function postDetails(
  entry: NonNullable<Notice["privatePosts"]>["details"][number],
  number: string,
  revision: string,
  index: number,
) {
  const row = record(record(entry?.raw.result).noceMap);
  if (!Object.keys(row).length) return undefined;
  const categories: Record<string, string> = {
    A: "변경공고사유",
    B: "취소공고사유",
    C: "지명경쟁조회",
    D: "입찰서작성전안내",
    E: "개찰결과조회",
  };
  return [
    { label: "입찰공고번호", value: value(row.odn1ColCn) || number },
    { label: "입찰공고차수", value: revision },
    {
      label: "공지유형",
      value: categories[value(row.odn3ColCn)] ?? value(row.odn3ColCnNm),
    },
    { label: "내용", value: value(row.bulkPstCn) },
    ...publicAttachmentFiles(
      attachmentGroup(row.untyAtchFileNo),
      entry?.attachments,
      "notice-post",
    ).map((file) => ({
      label: "공지사항 첨부파일",
      value: file.filename,
      href: file.downloadable
        ? attachmentHref(number, revision, file.seq) + "?post=" + index
        : undefined,
    })),
  ];
}

/** 공고번호·차수·첨부 순번으로 프로젝트의 첨부 다운로드 경로를 구성한다. */
function attachmentHref(number: string, revision: string, seq: string) {
  return (
    "/api/notices/" +
    encodeURIComponent(number) +
    "/" +
    encodeURIComponent(revision) +
    "/attachments/" +
    seq
  );
}

/** 민간공고 상세의 업무코드에 따라 물품·공사·용역 표의 열을 선택한다. */
const itemColumns: Record<string, Column[]> = {
  조070001: [
    ["No", "#"],
    ["품명", "ibxItemCfnm"],
    ["수량", "ibxCvlnPbancQty", (v) => amount(v)],
    ["단위", "sbxPrchsDtlItemUntVal"],
    ["납품기한", "calDlvgdsTermYmd", (v) => formatG2bDisplayDate(v, "date")],
    ["납품장소명", "ibxDlvgdsPlacNm"],
    ["인도조건", "sbxDevyCndtCd"],
  ],
  조070004: [
    ["No", "#"],
    ["공사명", "ibxCstrnNm"],
    ["준공기한", "calCmcnTermYmd", (v) => formatG2bDisplayDate(v, "date")],
    ["공사현장명", "ibxCntstNm"],
  ],
  조070002: [
    ["No", "#"],
    ["용역명", "ibxSrvNm"],
    ["완수기한", "calFlmtTermYmd", (v) => formatG2bDisplayDate(v, "date")],
    ["용역현장명", "ibxSrstNm"],
  ],
};

/**
 * 저장된 민간공고 원본 응답에서 나라장터 상세 화면에 대응하는 표시 섹션과 표를 구성한다.
 * 수집·저장된 원본을 수정하지 않고 화면에 필요한 값과 표시 조건만 변환한다.
 * @param raw 저장된 상세 응답의 result 객체.
 * @param postResponse 변경·취소 공고 전용 공지 목록 응답.
 * @param codeNames 나라장터 화면의 공통코드 조회에서 확보한 그룹별 이름.
 * @returns 원본 화면의 항목 순서와 조건에 따라 구성한 표시 섹션 목록.
 */
export function getPrivateNoticeDisplay(
  raw: Row,
  postResponse?: Notice["privatePosts"],
  codeNames?: Record<string, Record<string, string>>,
): Section[] {
  // 원본 응답의 기관·제한·공고 정보를 읽어 표시 모델을 구성한다.
  const detail = record(raw.bidPbancMap);
  const org = record(raw.pbancOrgMap);
  const limits = record(raw.dmItemMap);
  const code = (group: string, input: unknown, fallback?: unknown) =>
    codeNames?.[group]?.[value(input)] ?? (value(fallback) || value(input));
  const sections: Section[] = [];
  const number = value(detail.bidPbancNo);
  const revision = value(detail.bidPbancOrd);
  const posts = rows(record(postResponse?.list.result).noceList);
  // 최초 차수가 아니고 공지 번호가 있는 경우에만 변경·취소 공지 영역을 표시한다.
  if (revision !== "000" && value(posts[0]?.pstNo)) {
    sections.push({
      title: "공지사항(변경,취소공고사유 등)",
      fields: posts.map((post, index) => {
        const bbsNo = value(post.bbsNo);
        const pstNo = value(post.pstNo);
        const previousRevision =
          bbsNo === "R23AB00000108" &&
          ["A", "B"].includes(value(post.odn3ColCn)) &&
          Number(revision) > 0;
        return {
          value: "(" + value(post.inptDt) + ") " + value(post.pstNm),
          details: postDetails(
            postResponse?.details[index],
            number,
            revision,
            index,
          ),
          href: originalHref("NNBB027_01", {
            bbsNo,
            pstNo,
            bidPbancNo: number,
            bidPbancOrd: previousRevision
              ? String(Number(revision) - 1).padStart(3, "0")
              : revision,
          }),
        };
      }),
    });
  }

  const general = group("공고일반", [
    ...(detail.impvBizYn === "Y"
      ? [
          [undefined, "「정비사업 계약업무 처리기준」 적용 공고"] as [
            undefined,
            string,
          ],
        ]
      : []),
    [
      "입찰공고번호",
      value(detail.bidPbancNum).replace(/^(\w{13})(\d{3})$/, "$1-$2") ||
        number + "-" + revision,
    ],
    ["문서번호", detail.usrDocNoVal],
    [
      "공고처리구분",
      code("공40PN000", detail.pbancSttsCd, detail.pbancSttsCdNm),
    ],
    ["공고종류", code("공44PN000", detail.pbancKndCd, detail.pbancKndCdNm)],
    ["긴급여부", detail.emrgPbancYnLtrs],
    [
      "업무분류",
      code("조07NN000:supplement", detail.prcmBsneSeCd, detail.prcmBsneSeNm),
    ],
    [
      "게시일시",
      detail.bidPbancPgstCd === "진010008"
        ? "공고게시이전입니다."
        : dateTime(detail, "pbancPstgDt"),
    ],
    ["공고기관", detail.grpNm],
    ["공고명", detail.bidPbancNm],
  ]);
  for (const [index, related] of rows(raw.bidInfoList).entries()) {
    const bidPbancNo = value(related.bidPbancNo);
    const bidPbancOrd = value(related.bidPbancOrd);
    general.fields.push({
      label: index === 0 ? "관련공고" : undefined,
      value: bidPbancNo + "-" + bidPbancOrd,
      href: originalHref("NNBB002_01", { bidPbancNo, bidPbancOrd }),
    });
  }
  sections.push(
    general,
    group("입찰 및 계약방법", [
      [
        "계약방법",
        code("계03PN009", detail.stdCtrtMthdCd, detail.stdCtrtMthdCdNm),
      ],
      ["재입찰여부", detail.rbidPrmsYnLtrs],
      ["입찰방식", code("입18NN000", detail.bidMthdCd, detail.bidMthdCdNm)],
      [
        "낙찰방법",
        code(
          "낙03PN000",
          detail.scsbdMthdCd,
          detail.scsbdMthdCdNm ??
            getG2bCommonCodeName("낙03_PN000", value(detail.scsbdMthdCd)),
        ),
      ],
    ]),
    group("입찰진행", [
      ["입찰서접수시작일시", dateTime(org, "slprRcptBgngDt")],
      ["입찰서접수마감일시", dateTime(org, "slprRcptDdlnDt")],
      ["개찰일시", dateTime(org, "onbsPrnmntDt")],
      ["개찰장소", org.onbsPlacNm],
      ["입찰보증서 접수마감일시", dateTime(detail, "bidDepoPayTermDt")],
      ["입찰참가자격 등록마감일시", dateTime(org, "bidQlfcRegDt")],
    ]),
  );

  // 역경매 여부에 따라 별도 진행 항목과 금액 섹션의 표시 조건이 달라진다.
  const auction = detail.bidMthdCd === "입180003";
  if (auction)
    sections.push(
      group("역경매진행", [
        ["최소인하비율(%)", detail.minReduRt],
        ["투찰제한횟수", detail.etpsMaxBdngNotm],
        ["자동연장시각", detail.atmtExtsTmmn],
      ]),
    );
  // 민간공고의 업무코드에 맞는 상세내역 표만 구성한다.
  const columns = itemColumns[value(detail.prcmBsneSeCd)];
  if (columns)
    sections.push(
      columnTable(
        "입찰상세내역",
        raw.bidPbancItemlist,
        columns.map((column) =>
          column[1] === "sbxDevyCndtCd"
            ? [
                column[0],
                column[1],
                (input) => (input ? code("인01PN007", input) : "선택"),
              ]
            : column,
        ),
      ),
    );
  if (
    detail.stdCtrtMthdCd === "계030002" &&
    detail.cvlnPbancNmcptEtpsRlsYn === "Y"
  ) {
    sections.push(
      columnTable("지명경쟁업체", raw.bidPstmNomnEtpsList, [
        ["No", "#"],
        [
          "사업자등록번호",
          "ibxBzmnRegNo",
          (v) => v.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3"),
        ],
        ["조달업체명", "ibxGrpNm"],
        ["대표자명", "ibxRprsvNm"],
      ]),
    );
  }
  if (detail.scsbdMthdCd === "낙030001")
    sections.push(
      group("적격심사", [
        ["적격심사대상여부", detail.qlemTrgtYnLtrs],
        ["적격심사표", detail.cvlnQlemCrtrNm],
      ]),
    );
  sections.push(
    group("현장설명회", [
      ["현장설명회대상여부", detail.pbancDscrTrgtYnLtrs],
      ["현장설명회일시", dateTime(detail, "pbancBfssDt")],
      ["현장설명회장소", detail.pbancBfssPlacNm],
    ]),
  );
  if (!auction) {
    // 기준금액 비공개 조건을 원본 화면의 표시 규칙에 맞춰 적용한다.
    const hiddenPrice =
      detail.pnprRlsYn === "N" &&
      !["입160004", "입160010"].includes(value(detail.bidPbancPgstCd));
    sections.push(
      group("입찰금액", [
        [
          "부가가치세포함여부",
          value(detail.vatAplcnYnLtrs) +
            (detail.vatAplcnYn === "N"
              ? " (입찰가격은 부가가치세를 제외한 금액을 제출하셔야 합니다 .)"
              : ""),
        ],
        ["배정예산", amount(detail.alotBgtAmt) + " 원"],
      ]),
      group("기준금액", [
        ["기준금액사용여부", detail.pnprUseYnLtrs],
        ["기준금액공개여부", detail.pnprRlsYnLtrs],
        ["기준금액", hiddenPrice ? "원" : amount(detail.evlcrtAmt) + " 원"],
      ]),
    );
  }
  if (!(Number(detail.bidPrgrsOrd) < 0))
    sections.push(
      columnTable("입찰(재입찰)내역", raw.rbidList, [
        ["재입찰번호", "bidPrgrsOrd"],
        ["공고명", "bidPbancNm"],
        ["개찰일시", "onbsPrnmntDt", formatG2bDisplayDateTime],
        ["진행현황", "bidPgstCdNm"],
      ]),
    );
  sections.push(
    group("투찰제한", [
      ["업종제한", detail.lcnsLmtYnLtrs],
      ["지사/지점허용여부", detail.bofcBdngPrmsYnLtrs],
      ["지역제한", detail.rgnLmtYnLtrs],
    ]),
  );
  // onpageload에서 두 목록 영역을 숨기며 상세 조회 성공 분기에서도 다시 노출하지 않는다.
  const showLicenseDetails = limits.lcnsLmtYnNm !== "공고서참조";
  const generalLimits = group("투찰제한-일반", [
    ["지역제한", limits.rgnLmtYnNm],
    ["참가가능지역", limits.rgnLmtCn],
    ["업종제한", limits.lcnsLmtYnNm],
    ...(showLicenseDetails
      ? [["업종제한사항", limits.intpLmtCn] as [string, unknown]]
      : []),
  ]);
  if (showLicenseDetails) {
    const license = columnTable("투찰가능한업종", raw.dmLcnsLmtPrmsIntpList, [
      ["No", "#"],
      ["투찰가능한업종", "lmtIntpNm"],
      ["허용업종", "bidPrmsIntpNm"],
    ]);
    license.note =
      "업종명을 클릭시 관련 근거법령을 조회하실수 있습니다. []안의 업종제한은 시스템상에 입력된 제한사항으로 공고서와 상이할 수도 있습니다. 입찰에 참여하시기 전에 반드시 공고서를 숙지하여 정확한 제한 업종을 확인하시기 바랍니다. 아래는 제한된 업종에 대해 투찰가능한 허용업종 상황을 보여줍니다. 확인하시기 바랍니다.";
    generalLimits.nestedTable = license;
  }
  sections.push(generalLimits);
  const contact = group("입찰담당정보", [
    ["담당부서", detail.grpNm],
    ["담당자", detail.usrNm],
  ]);
  contact.fields.push({
    value: "상세보기",
    details: [
      { label: "담당자", value: value(detail.usrNm) },
      { label: "연락처", value: formatG2bPhone(value(detail.bsneTlphNo)) },
      { label: "이메일", value: value(detail.bsneEml) },
    ],
  });
  sections.push(contact);
  if (detail.cvlnOrbySeCd === "민010001")
    sections.push(
      group("단지정보", [
        ["단지명", detail.grpNm],
        ["단지주소", detail.untyAddr],
        ["연락처", formatG2bPhone(value(detail.hsmpMngOfceTlphNo))],
        ["홈페이지", detail.hmpgUrl],
        ["연면적", value(detail.hsmpSqms) + " ㎡"],
        ["관리비부과면적", value(detail.hsmpMgcsLevySqms) + " ㎡"],
        [
          "세대수/동수",
          amount(detail.hsmpHshdCnt) + " / " + amount(detail.hsmpBldgCnt),
        ],
        [
          "난방방식",
          code("단08PR000", detail.hsmpHeatMthoCd, detail.hsmpHeatMthoNm),
        ],
        ["부대및복리시설", detail.hsmpWefrFcltDtlCn],
      ]),
    );
  return sections;
}

/**
 * 나라장터 민간공고 첨02NN005 조회에서 확인한 문서구분의 표시명이다.
 * 재수집 없이도 공통코드 조회가 누락된 저장 공고를 표시할 수 있다.
 */
const privateAttachmentKindNames = new Map([
  ["첨020297", "공고서"],
  ["첨020417", "공고서(변환본)"],
  ["첨020033", "규격서"],
  ["첨020109", "기타문서"],
]);

/**
 * 민간공고 공개 첨부를 공통 첨부파일 표에서 사용하는 표시 형식으로 변환한다.
 * 저장된 원본 첨부 메타데이터와 문서구분 코드를 읽으며 원본을 변경하지 않는다.
 * @returns 원본 순서의 공개 파일과 다운로드 주소. 다운로드 제한 파일에는 주소를 제공하지 않는다.
 */
export function getPrivateNoticeAttachmentFiles(notice: Notice) {
  const attachments = notice.documents?.attachments;
  const files = publicAttachmentFiles(
    noticeAttachmentGroup(notice.payload),
    attachments,
    "private-notice",
  );
  const metadata = new Map(
    rows(attachments?.dlUntyAtchFileL).map((row) => [
      value(row.atchFileSqno),
      row,
    ]),
  );
  const rule = value(
    record(record(notice.payload.result).bidBsneCndtCrtrCdMap).bsneCndt1Val,
  );
  const now = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(new Date())
    .replace(/\D/g, "");
  // 문서구분 기준 시각이 지난 경우 보충 코드명과 원본 공고서명을 우선 적용한다.
  const changedCodes = rule && rule < now;
  const names = notice.privateCodeNames?.["첨02NN005"];
  const supplementalNames = notice.privateCodeNames?.["첨02NN005:supplement"];
  return files.map((file) => {
    const row = metadata.get(file.seq) ?? {};
    const href = attachmentHref(notice.number, notice.revision, file.seq);
    const type = value(row.atchFileKndCd);
    const originalName =
      changedCodes && type === "첨020297" ? "공고서(원본)" : undefined;
    const typeName =
      (changedCodes && value(supplementalNames?.[type]).trim()) ||
      originalName ||
      value(names?.[type]).trim() ||
      privateAttachmentKindNames.get(type);
    return {
      ...file,
      documentType: typeName,
      href: file.downloadable ? href : undefined,
    };
  });
}

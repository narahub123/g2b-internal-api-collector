import { decodeHTMLStrict } from "entities";
import {
  G2B_COMMON_CODE_COMPONENT_GROUPS,
  getG2bCommonCodeName,
} from "@/shared/lib/common-codes";
import type { Contract } from "./contract";
import { formatG2bPhone } from "@/shared/lib/g2b-phone";
import {
  formatG2bDisplayDate,
  formatG2bDisplayNumber,
  formatG2bDisplayRate,
} from "@/shared/lib/g2b-display-format";

/** 공통코드 API 조회 없이 화면에서 직접 변환하는 Y/N 선택값 목록. */
const inlineOptions: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  longTerm: { Y: "예", N: "아니오" },
  international: { Y: "국제", N: "국내" },
  agreement: { Y: "공정계약 서약서 동의", N: "" },
};
/** 필드별 값 변환 방식. 공통코드 컴포넌트 식별자도 포함한다. */
type Format =
  | "date"
  | "integer"
  | "rate"
  | "phone"
  | "trade"
  | "longTerm"
  | "international"
  | "agreement"
  | keyof typeof G2B_COMMON_CODE_COMPONENT_GROUPS;
/** 화면 순서대로 선언하는 [API 키, 라벨, 선택적 변환 방식] 튜플. */
type Field = readonly [key: string | null, label: string, format?: Format];
/** 단일 필드의 화면 출력 단위. 링크 필드는 href를 함께 가진다. */
type DetailRow = { label: string; value: string; href?: string };

/**
 * 포맷을 마친 화면 값에 실제로 표시할 내용이 있는지 판별한다.
 * API 원본 값이 아니라 화면 값을 검사하여 기본값·공통코드 변환 결과를 보존한다.
 * 예: ctrtTyCd가 null이어도 계약유형의 표시값 "총액계약"은 유지한다.
 * @param value 날짜·숫자·공통코드 변환을 마친 문자열.
 * @returns 공백을 제외한 표시 내용이 있으면 true.
 */
function hasDisplayValue(value: string): boolean {
  return value.trim().length > 0;
}
/** 물품 표의 두 줄 헤더 분할 위치와 행 병합 대상 열 인덱스. */
type PairedRows = { firstRowLength: number; sharedColumns: readonly number[] };

/** 계약공통 섹션의 기본 필드. 배열 순서가 화면 표시 순서다. */
const commonFields: readonly Field[] = [
  ["ctrtView", "계약번호"],
  ["frstCtrtDt", "계약일자", "date"],
  ["jintSyddCmnMthoCd", "공동도급방식", "sbxJoctMthoCd"],
  ["ctrtNm", "계약명"],
  ["newLotmSeCd", "신규장기구분", "sbxNewLotmSeCd"],
  ["lotmYn", "장기여부", "longTerm"],
  ["ctrtMthdCd", "계약방법", "sbxCtrtMthdCd"],
  ["tlbkpngCtrtAmt", "총 계약금액(원)", "integer"],
  ["ctrtAmt", "금차 계약금액(원)", "integer"],
  ["ctrtGtnrt", "계약보증금율(%)", "rate"],
  ["lcrtTyCd", "계약법구분", "rdoLcrtTyCd"],
  ["atcsNm", "조항호"],
  ["prvNm", "근거내역"],
  ["ctrtTyCd", "계약유형", "sbxCtrtTyCd"],
  ["drpmSbpySeCd", "지급방법", "rdoDwpmGiveMthdCd"],
  // 원본 화면에서 숨겨진 필드이므로 표시 목록에서는 제외한다. 수집 데이터는 유지한다.
  // ["intbidYn", "국내/국제입찰", "international"],
  ["dlvgdsTermChcSeCd", "총 납품기간 선택", "rdoDlvgdsTermChcSeCd"],
  ["totlDlvgdsTermYmd", "총 납품기한", "date"],
  ["totlDlvgdsTermNody", "총 납품일수", "integer"],
];

/** 계약업체 정보 표의 기본 열 정의. 업무별로 일부 열을 제외할 수 있다. */
const companyFields: readonly Field[] = [
  ["ctentSeNm", "구분"],
  ["jintSyddCmnMthoNm", "공동도급방식"],
  ["bzmnRegNo", "사업자등록번호"],
  ["ctentUntyGrpNm", "업체명"],
  ["intpNm", "공종", "trade"],
  ["shreIntpSharRat", "지분율(%)", "rate"],
  ["ctrtSharRat", "전체지분율(%)", "rate"],
  ["etpsPicNm", "업체담당자"],
  ["rprsvNm", "대표자명"],
];
/** 서비스 정보 표의 열 정의. null 키는 현재 연결된 API 값이 없는 열이다. */
const serviceFields: readonly Field[] = [
  ["rprsItemYn", "대표여부"],
  ["intpNm", "업종"],
  ["cntstNm", "지역"],
  [null, "품목"],
  [null, "금액"],
  ["etpsNm", "관련업체"],
];
/** 계약물품 정보 표의 열 정의. 물품 2행 표에서 열 순서를 유지한다. */
const itemFields: readonly Field[] = [
  ["itemClsfNo", "물품분류번호"],
  ["itemIdnfNo", "물품식별번호"],
  ["ctrtItemNm", "품명"],
  ["dlvgdsTermNody", "납품일수", "integer"],
  ["dlvgdsTermYmd", "납품기한", "date"],
  ["devyCndtNm", "인도조건"],
  ["ctrtUprc", "단가(원)", "integer"],
  ["ctrtQty", "수량(개)", "integer"],
  ["itemSpecVal", "규격"],
  ["ctrtAmt", "금액(원)", "integer"],
  ["odn1PlorNtnNm", "원산지"],
];

/**
 * API 값을 화면 표시용 문자열로 변환하고 HTML 엔티티를 해제한다.
 * @param value API 원본 필드값.
 * @returns 숫자·문자열의 표시값 또는 빈 문자열.
 */
function text(value: unknown) {
  // 0도 유효한 표시값이므로 숫자는 문자열로 변환해 보존한다.
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? decodeHTMLStrict(value) : "";
}

/**
 * 원본 필드값에 날짜·숫자·전화번호·공통코드 등의 표시 규칙을 적용한다.
 * @param value API 원본 필드값.
 * @param format 필드별 표시 형식.
 * @returns 화면에 사용할 최종 문자열.
 */
function formatValue(value: unknown, format?: Format) {
  const raw = text(value);
  const trimmed = raw.trim();
  // 계약유형은 원본 select의 첫 옵션 표시를 유지하므로 빈 원본값도 기본 표시값이 있다.
  // 그 외 빈 원본값은 빈 문자열로 두고, 이후 섹션 생성 시 해당 필드를 제외한다.
  if (!trimmed) {
    return format === "sbxCtrtTyCd" ? "총액계약" : "";
  }
  // 별도 변환 규칙이 없으면 HTML 엔티티만 해제한 값을 사용한다.
  if (!format) return raw;
  // 날짜는 YYYYMMDD, YYYY-MM-DD 등을 동일한 YYYY/MM/DD 형태로 표시한다.
  if (format === "date") {
    return formatG2bDisplayDate(trimmed, "date");
  }
  if (format === "integer") {
    return formatG2bDisplayNumber(raw, 0);
  }
  if (format === "rate") return formatG2bDisplayRate(raw);
  // 전화번호 포맷은 공통 함수에서 처리한다.
  // 마스킹된 번호와 기존 구분자는 유지하고, 숫자만 있는 번호는 형식에 맞게 변환한다.
  if (format === "phone") {
    return formatG2bPhone(raw);
  }
  // 원본 화면에서 공동이행은 별도 공종명으로 출력하지 않는다.
  if (format === "trade") return raw === "공동이행" ? "" : raw;
  // 화면 내부의 Y/N 매핑은 API 공통코드 조회 없이 변환한다.
  if (
    format === "longTerm" ||
    format === "international" ||
    format === "agreement"
  ) {
    return inlineOptions[format][trimmed] ?? raw;
  }
  // 나머지 코드값은 기존 공통코드 컴포넌트 그룹에 따라 명칭으로 변환한다.
  return getG2bCommonCodeName(
    G2B_COMMON_CODE_COMPONENT_GROUPS[format],
    trimmed,
  );
}

/** 원본 계약현황의 업무 분기, 필드 순서, 값 표시 규칙을 적용한다.
 * @param contract 저장된 계약 상세와 세 복합 목록.
 * @returns 헤더 제목, 단일 필드 섹션, 복합 테이블의 표시 모델.
 */
export function contractDisplay(
  contract: Pick<Contract, "detail" | "companies" | "services" | "items">,
) {
  const { detail, companies, services, items } = contract;
  // 계약 업무 구분에 따라 원본 화면의 추가 필드와 목록 표시 여부가 달라진다.
  const businessName = text(detail.prcmBsneSeNm);
  // 업무명에 여러 구분이 포함될 수 있어 원본 if/else의 우선순위를 유지한다.
  const business = [
    "일반용역",
    "공사",
    "기술용역",
    "물품",
    "외자",
    "리스",
    "비축",
    "기타",
  ].find((name) => businessName.includes(name));
  // 특정 기관·외자 여부 조합에서는 원본 화면의 계약 금액 컨트롤이 숨겨진다.
  const hiddenAmounts =
    text(detail.dmstUntyGrpNo).includes("IN0100000039225") &&
    text(detail.frcpYn).includes("Y");
  // 기본 정의를 복사해 업무별 필드를 덧붙인다. 공유 상수 배열은 변경하지 않는다.
  const common: Field[] = [...commonFields];
  // 공사·기술용역·리스는 서로 다른 기한·기간 필드를 사용한다.
  if (business === "공사") {
    common.push(
      ["totlFlmtYmd", "총 준공일자", "date"],
      ["osetYmd", "착공일자", "date"],
      ["flmtYmd", "준공일자", "date"],
    );
  } else if (business === "기술용역") {
    common.push(
      ["totlFlmtYmd", "총 완수일자", "date"],
      ["osetYmd", "착수일자", "date"],
      ["flmtYmd", "완수일자", "date"],
    );
  } else if (business === "리스") {
    common.push(
      ["lasePrdMtnb", "리스기간(개월)", "integer"],
      ["laseBgngYmd", "리스시작일자", "date"],
      ["laseEndYmd", "리스종료일자", "date"],
    );
  }
  // 하자 관련 필드는 업무별 추가 필드 뒤에 배치한다.
  common.push(
    ["dcmtGtnrt", "하자보수보증금율(%)", "rate"],
    ["fctrRspbPrdCn", "하자담보책임기간"],
  );

  /**
   * 단일 필드 섹션의 표시 행을 만들고 빈값 필드를 제거한다.
   * @param title 섹션 제목.
   * @param fields 원본 화면 순서에 따른 필드 정의.
   * @returns 빈값을 제외한 섹션 표시 모델.
   */
  function section(title: string, fields: readonly Field[]) {
    return {
      title,
      rows: fields
        .map(([key, label, format]): DetailRow => {
          // 원본에서 숨기는 금액은 값이 있어도 표시하지 않는다.
          // 이번 화면 정책에서는 빈값의 라벨도 숨기므로 해당 행 전체를 제외한다.
          const hidden =
            (key === "ctrtAmt" && (hiddenAmounts || business === "리스")) ||
            (key === "tlbkpngCtrtAmt" && hiddenAmounts);
          return {
            label,
            value: key && !hidden ? formatValue(detail[key], format) : "",
          };
        })
        // 값이 없는 필드는 라벨까지 표시하지 않는다. 원본 필드 순서는 유지한다.
        .filter(({ value }) => hasDisplayValue(value)),
    };
  }
  // 원본의 섹션 배치 순서를 먼저 구성한 다음, 마지막에 빈 섹션만 제외한다.
  const sections = [
    section("계약담당자 정보", [
      ["mngrNm", "사무관 또는 서기관"],
      ["ctrtPicNm", "계약담당자"],
      ["procsCtrtWtotAgreYn", "공정계약 서약서 동의", "agreement"],
    ]),
    section("계약자 정보", [
      ["dmstUntyGrpNm", "수요기관"],
      ["dmstPicNm", "수요기관 담당자"],
      ["dmstTlphNo", "수요기관 전화번호", "phone"],
      ["rprsCtentUntyGrpNm", "계약대표업체"],
      ["ctentPicNm", "업체 담당자"],
      [null, "업체 전화번호"],
    ]),
    section("계약공통", common),
  ];
  // 기타 업무에서만 원본의 외부 링크 섹션을 추가한다.
  if (business === "기타") {
    const url = "https://cfms.airport.kr:9443";
    sections.push({
      title: "예정가격 결정 및 입찰금액 정보",
      rows: [{ label: "링크URL", value: url, href: url }],
    });
  }

  /**
   * 복합 목록을 표 표시 모델로 변환하고 내용 없는 데이터 행을 제거한다.
   * @param title 표 제목.
   * @param fields 원본 화면 순서에 따른 표 열 정의.
   * @param records API에서 수집한 목록 데이터.
   * @param pairedRows 물품 표의 2행 헤더·공유 셀 구성.
   * @returns 유효한 행에만 No를 부여한 표 표시 모델.
   */
  function table(
    title: string,
    fields: readonly Field[],
    records: Record<string, unknown>[],
    pairedRows?: PairedRows,
  ) {
    return {
      title,
      pairedRows,
      columns: ["No", ...fields.map(([, label]) => label)],
      rows: records
        .map((row) =>
          fields.map(([key, , format]) =>
            key ? formatValue(row[key], format) : "",
          ),
        )
        // No는 자동 생성값이므로 실제 데이터 유무 판단에서 제외한다.
        // 데이터가 전부 빈 행은 제거하고 남은 행에만 번호를 다시 부여한다.
        // 자동 번호나 헤더가 아닌 실제 필드 값만 검사한다.
        .filter((values) => values.some(hasDisplayValue))
        .map((values, index) => [String(index + 1), ...values]),
    };
  }
  // 업무구분에 따라 원본 화면에서 제공하는 목록만 구성한다.
  // 표의 데이터가 모두 비었다면 반환 직전에 표 전체를 제외한다.
  const tables: ReturnType<typeof table>[] = [];
  // 업무 유형별 원본 화면의 목록 노출 조건을 그대로 유지한다.
  const showServices =
    business === "일반용역" || business === "공사" || business === "기술용역";
  const showItems =
    business === "물품" ||
    business === "외자" ||
    business === "리스" ||
    business === "비축";
  // 업체 표는 서비스·물품 관련 업무에만 만들며, 일부 업무는 공종·지분율 열을 제외한다.
  if (showServices || showItems) {
    const fields =
      business === "일반용역" || business === "물품"
        ? companyFields.filter(
            ([key]) => key !== "intpNm" && key !== "shreIntpSharRat",
          )
        : companyFields;
    tables.push(table("계약업체 정보", fields, companies));
  }
  // 서비스 목록은 서비스 관련 업무에서만 생성한다.
  if (showServices) tables.push(table("서비스 정보", serviceFields, services));
  // 원본 물품 그리드는 No와 인도조건을 각 품목의 두 행에서 공유한다.
  if (showItems)
    tables.push(
      table("계약물품 정보", itemFields, items, {
        firstRowLength: 7,
        sharedColumns: [0, 6],
      }),
    );
  return {
    title: text(detail.ctrtNm),
    // 내용이 없는 섹션과 테이블은 아코디언 자체를 만들지 않는다.
    // 원래 배열을 필터링하므로 섹션·테이블의 표시 순서는 유지된다.
    sections: sections.filter(({ rows }) => rows.length > 0),
    tables: tables.filter(({ rows }) => rows.length > 0),
  };
}

/** 공식 응답 문서의 업무 필드 순서와 API별 저장 대상을 정의한다. */
export const BUSINESS_APIS = {
  // getPrcrmntCorpBasicInfo02의 업무 필드만 정해진 순서대로 보존한다.
  basic: {
    operation: "getPrcrmntCorpBasicInfo02",
    table: "business_basic",
    certificate: null,
    fields: "bizno corpNm engCorpNm opbizDt rgnCd rgnNm zip adrs dtlAdrs telNo faxNo cntryNm hmpgAdrs mnfctDivCd mnfctDivNm emplyeNum corpBsnsDivCd corpBsnsDivNm hdoffceDivNm rgstDt chgDt esntlNoCertRgstYn ceoNm".split(" "),
  },
  // getPrcrmntCorpIndstrytyInfo02의 업무 필드만 정해진 순서대로 보존한다.
  industry: {
    operation: "getPrcrmntCorpIndstrytyInfo02",
    table: "business_industry",
    certificate: null,
    fields: "bizno indstrytyNm indstrytyCd rgstDt vldPrdExprtDt systmRgstDt chgDt indstrytyStatsNm rprsntIndstrytyYn systmChgDt".split(" "),
  },
  // getPrcrmntCorpSplyPrdctInfo02의 업무 필드만 정해진 순서대로 보존한다.
  product: {
    operation: "getPrcrmntCorpSplyPrdctInfo02",
    table: "business_product",
    certificate: null,
    fields: "bizno dtilPrdctClsfcNoNm dtilPrdctClsfcNo rgstDt chgDt rprsntPrdctClsfcNoNmYn mnfctYn".split(" "),
  },
  // getUnptRsttCorpInfo02의 업무 필드만 정해진 순서대로 보존한다.
  sanction: {
    operation: "getUnptRsttCorpInfo02",
    table: "business_sanction",
    certificate: null,
    fields: "bizno corpNm unptRsttDocNm rsttBgnDate rsttEndDate insttCd insttNm lawordNm lawordArtclClause lawordArtclClauseCd lawordArtclClauseCdNm enfcAtcsCd enfcPrvNm ntfcnDt rsttPrdMonthNum rsttPrdDayNum rsttProgrsNm".split(" "),
  },
  // getDPrductList의 업무 필드만 정해진 순서대로 보존한다.
  directProduction: {
    operation: "getDPrductList",
    table: "business_smpp",
    certificate: "01",
    fields: "certSeCode validPdBeginDe validPdEndDe certfcDe detailPrdnmNo essntlPartclrMatter".split(" "),
  },
  // getFnrssList의 업무 필드만 정해진 순서대로 보존한다.
  women: {
    operation: "getFnrssList",
    table: "business_smpp",
    certificate: "03",
    fields: "certSeCode issuInstt validPdBeginDe validPdEndDe certfcDe".split(" "),
  },
  // getDspsnList의 업무 필드만 정해진 순서대로 보존한다.
  disabled: {
    operation: "getDspsnList",
    table: "business_smpp",
    certificate: "04",
    fields: "certSeCode issuInstt validPdBeginDe validPdEndDe certfcDe".split(" "),
  },
} as const;

/** 사업자 한 곳에 대해 독립적으로 수집·재시도하는 API 식별자다. */
export type BusinessApi = keyof typeof BUSINESS_APIS;

/** 업무 필드의 원래 스칼라 값을 보존하며 누락 필드는 키로 만들지 않는다. */
export type BusinessItem = Record<string, string | number | boolean | null>;

/** 7종 수집 상태 초기화 및 실행권 확보에 사용하는 API 순서다. */
export const BUSINESS_API_KINDS = Object.keys(BUSINESS_APIS) as BusinessApi[];

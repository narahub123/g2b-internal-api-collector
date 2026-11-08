type RecordValue = Record<string, unknown>;
type Column = readonly [key: string, label: string];
type Field = readonly [key: string, label: string, visible?: boolean];

const schedule = [
  ['subject', '진행명'], ['prgNm', '진행방법'], ['startDt', '시작일시'],
  ['endDt', '종료일시'], ['placNm', '장소'],
] as const;

const itemColumns = [
  ['bidClsfNo', '분류'], ['dmstUntyGrpNm', '수요기관'], ['dtlsPrnmNm', '세부품명'],
  ['dtlsPrnmNo', '세부품명번호'], ['itemIdnfNo', '물품식별번호'], ['itemDtlSpecCn', '규격'],
  ['prchsDtlItemQty', '수량'], ['prchsDtlItemUntValNm', '단위'], ['prchsDtlItemUprc', '추정단가(원)'],
  ['dlvgdsTermNody', '납품일수'], ['dlvgdsTermDt', '납품기한'], ['dlvgdsPlacNm', '납품장소'], ['devyCndtNm', '인도조건'],
] as const;

const contactColumns = [
  ['dmstUntyGrpNm', '수요기관'], ['deptNm', '부서명'], ['picNm', '담당자'],
  ['faxNo', '팩스번호'], ['tlphNo', '전화번호'],
] as const;

export function displayValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (typeof value === 'number') return String(value);
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function fields(source: RecordValue, definitions: readonly Field[]) {
  return definitions.flatMap(([key, label, visible = true]) => {
    const value = visible ? displayValue(source[key]) : undefined;
    return value === undefined ? [] : [{ label, value }];
  });
}

function table(title: string, source: unknown, columns: readonly Column[]) {
  const rows = Array.isArray(source) ? source.map(record) : [];
  const visible = columns.filter(([key]) => rows.some((row) => displayValue(row[key]) !== undefined));
  return {
    title,
    columns: visible.map(([, label]) => label),
    rows: rows.map((row) => visible.map(([key]) => displayValue(row[key])))
      .filter((row) => row.some((value) => value !== undefined)),
  };
}

export function getNoticeDisplay(payload: RecordValue) {
  const detail = record(payload.dmItemMap);
  const guide = record(payload.dmItemGuidMap);
  const evaluation = record(payload.dmEvlStepMap);
  const standard = detail.stdPbancDocAplcnYn === 'Y';
  const goods = detail.prcmBsneSeCd === '01';
  const services = detail.prcmBsneSeCd === '03';
  const own = detail.prcmMthoSeCd === '조020002';
  const negotiated = detail.scsbdMthdCd === '낙030005';
  const staged = detail.scsbdMthdCd === '낙030002' || detail.scsbdMthdCd === '낙030003';
  const showEvaluator = (negotiated || staged) && !own;
  const regionLimited = detail.rgnLmtYn === 'Y';
  const licenseLimited = detail.lcnsLmtYn === 'Y';
  const internalItems = detail.iritemClsfNoUseYn === 'Y';
  const contacts = showEvaluator && Array.isArray(payload.dmItemList2)
    ? payload.dmItemList2.map((value) => {
      const contact = record(value);
      return { ...contact, evlPicYn: contact.evlPicYn === 'Y' ? '예' : '아니오' };
    })
    : payload.dmItemList2;
  const guideSource = Object.fromEntries(
    ['bulkPbancGuidCn', 'bulkPbancScsbdMthdCn', 'bulkBidPrqfGuidCn', 'bulkBidPrgrsEtcCn', 'bulkPrplPrsntnEtcCn', 'bulkSbmsnDocCn', 'bulkPbancEtcCn']
      .map((key) => [key, displayValue(guide[key]) ?? detail[key]]),
  );

  const groups = [
    { title: '공고 기본정보', fields: fields(detail, [
      ['bidPbancText', '입찰공고번호'], ['pbancKndNm', '공고종류'], ['pbancPstgDt', '공고게시일'],
      ['usrDocNoVal', '참조번호'], ['bidMthdNm', '입찰방식'], ['scsbdMthdNm', '낙찰방법'],
      ['scsbdMthdDtlsNm', '낙찰방법 세부기준', /^[RT]/.test(String(detail.bidPbancNo ?? ''))],
      ['scsbdLwlmRat', '낙찰하한율', Number(detail.scsbdLwlmRat) > 0],
      ['stdCtrtMthdNm', '계약방법'], ['ctrtTyNm', '계약구분'], ['dmstcOvrsSeNm', '국내·국제입찰 구분'],
      ['jintCtrtCmnMthoNm', '공동수급 방식'], ['rbidPrmsYnNm', '재입찰 허용 여부'],
      ['samePrceBidAtmtDrawYnNm', '동일가격 입찰 자동추첨 여부'],
      ['inspInstSeNm', '검사기관', !own], ['igiInspInstSeNm', '검수기관', !own],
      ['rschDvlpItemYnNm', '연구개발물품 여부', !services],
      ['wtoItmltNm', 'WTO 품목번호명', services], ['sckrAplcnYnNm', '하도급지킴이 적용 여부', services],
      ['pbancBfssPlacNm', '현장설명회 장소', services && own], ['pbancBfssDt', '현장설명 일시'],
    ]) },
    { title: '공고 안내', fields: fields(guideSource, [['bulkPbancGuidCn', '공고 안내', standard]]) },
    { title: '입찰 참가 자격 및 제한', fields: [
      ...fields(detail, [
        ['prfmncLmtYnNm', '실적제한 여부'], ['mnftrItemLmtYnNm', '제조 여부'],
        ['rgnLmtYnNm', '지역제한 여부'], ['rgnLmtCn', '참가 가능 지역', regionLimited],
        ['rgnLmtGuidCn', '지역제한 안내', regionLimited], ['lcnsLmtYnNm', '업종제한 여부'],
        ['intpLmtCn', '업종제한 안내', licenseLimited],
        ['itemClsfBdngLmtAtrbNm', '물품분류 투찰제한', !(services && own)],
        ['mnftrItemLmtCn', '물품등록구분', !services],
      ]),
      ...fields(guideSource, [['bulkBidPrqfGuidCn', '입찰참가자격 및 등록 안내', standard]]),
    ] },
    { title: '입찰 진행 안내', fields: fields(guideSource, [['bulkBidPrgrsEtcCn', '입찰진행정보 기타', standard && goods]]) },
    { title: '낙찰 및 평가', fields: [
      ...fields(guideSource, [
        ['bulkPbancScsbdMthdCn', '낙찰방법 안내', standard],
        ['bulkPrplPrsntnEtcCn', '제안서 발표순서 기타', standard && negotiated],
      ]),
      ...fields(evaluation, [
        ['evlMaagSeNm', '평가주체', negotiated || staged],
        ['evlSysUtztnYnNm', '평가시스템 이용 여부', negotiated || staged],
        ['evlPlacNm', '평가 장소', negotiated || staged],
        ['techAbltEvlRt', '기술능력 평가비율', negotiated], ['bidPrceEvlRt', '입찰가격 평가비율', negotiated],
        ['stbltCrtrScr', '적격 기준 점수', staged], ['rfpSbmsnDocTyNm', '제안서 제출 문서 유형', negotiated || staged],
      ]),
    ] },
    { title: '제출 서류', fields: fields(guideSource, [['bulkSbmsnDocCn', '제출 서류 안내', standard]]) },
    { title: '가격 정보', fields: [
      ...fields(detail, [
        ['pnprDcsnMthoNm', '예가방법'], ['bizAmt', '사업금액 (추정가격 + 부가세)'],
        ['alotBgtAmt', '배정예산'], ['prspPrce', '추정가격'],
      ]),
      ...fields(guideSource, [['bulkPbancEtcCn', '가격 기타 안내', standard]]),
    ] },
    { title: '기관 담당자 정보', fields: fields(detail, [
      ['pbancInstUntyGrpNm', '공고기관'], ['pbancPicNm', '공고담당자'],
      ['pbancPicTlphNo', '공고담당자 전화번호'], ['bidBlffNm', '집행관'],
    ]) },
    { title: '관련 공고 정보', fields: fields(detail, [
      ['bfSpecRegNo', '사전규격등록번호'], ['bfSpecUndsRsnNm', '사전규격 미공개 사유'],
      ['oderPlanNo', '발주계획번호', Boolean(displayValue(detail.oderPlanUntyNo))],
    ]) },
    { title: '공고 기타', fields: fields(detail, [['pbancEtcCn', '공고 기타 안내', standard]]) },
  ].filter((group) => group.fields.length > 0);

  const tables = [
    table('입찰 진행 일정', payload.dmItemList1, schedule),
    table('구매 품목', services && own ? undefined : payload.dmItemItemList,
      internalItems ? [...itemColumns, ['iritemClsfNm', '자체물품명'], ['iritemClsfNo', '자체물품번호']] : itemColumns),
    table('수요기관 담당자', contacts, showEvaluator ? [...contactColumns, ['evlPicYn', '평가담당자 여부']] : contactColumns),
    table('입찰 진행 현황', payload.dlBidBasePgstL, [
      ['bidPbancNoOrd', '입찰공고번호'], ['bidPrgrsOrd', '재입찰번호'], ['bidPbancNm', '공고명'],
      ['onbsPrnmntDt', '개찰일시'], ['bidPgstNm', '진행현황'],
    ]),
  ].filter((entry) => entry.rows.length > 0);

  return { groups, tables };
}

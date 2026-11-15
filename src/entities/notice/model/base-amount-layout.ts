/** 기초금액 원본 마크업의 표시 순서, 초기 숨김 상태와 데이터 바인딩을 정의한다. */
export type BaseAmountLayoutNode = {
  kind: "group" | "heading" | "text" | "paragraph" | "break" | "list" | "item" |
    "table" | "tableBody" | "row" | "label" | "cell" | "grid" | "download" | "posts";
  id?: string;
  hidden?: boolean;
  text?: string;
  binding?: string;
  digits?: 0 | 3;
  colSpan?: number;
  rowSpan?: number;
  children?: BaseAmountLayoutNode[];
};

// 원본의 화면 요소 ID를 유지해 숨김·표시 규칙과 대조할 수 있게 한다.
export const baseAmountLayout: BaseAmountLayoutNode[] = [
  { kind: "group", id: "grpHelpBox", children: [
    { kind: "group", id: "grpCmtInner", children: [
      { kind: "group", id: "txbAtmtCntt", children: [
        { kind: "text", text: "유의사항" },
        { kind: "text", id: "bidInfo" },
      ] },
    ] },
  ] },
  { kind: "group", id: "taskClCd1", children: [
    { kind: "heading", text: "공고일반" },
  ] },
  { kind: "group", id: "taskClCd2", children: [
    { kind: "table", children: [
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "입찰공고번호" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.bidPbancNoPbancOrd" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "입찰공고명" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", id: "bidPbancNm", binding: "dlBsisAmtRM.bidPbancNm" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "참조번호" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.usrDocNoVal" }] },
        { kind: "label", children: [{ kind: "text", text: "개찰일시" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.onbsPrnmntDt" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "공고기관" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.pbancInstUntyGrpNm" }] },
        { kind: "label", children: [{ kind: "text", text: "수요기관" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.dmstNm" }] },
      ] },
      { kind: "row", id: "isNegotiationTag", children: [
        { kind: "label", children: [{ kind: "text", text: "유의사항" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.atmr" }] },
      ] },
    ] },
  ] },
  { kind: "group", id: "taskClCd3", children: [
    { kind: "text", text: "기초금액" },
    { kind: "text", text: "전체" },
    { kind: "text", id: "tbxExmnItemTotCnt", text: "0" },
    { kind: "text", text: "건" },
  ] },
  { kind: "group", id: "taskClCd4", children: [
    { kind: "grid" },
  ] },
  { kind: "group", id: "taskClCd5", children: [
    { kind: "heading", text: "예비가격" },
  ] },
  { kind: "group", id: "taskClCd6", children: [
    { kind: "table", children: [
      { kind: "tableBody", children: [
        { kind: "row", children: [
          { kind: "label", children: [{ kind: "text", text: "예비가격" }] },
          { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtM.sign" }] },
        ] },
      ] },
    ] },
  ] },
  { kind: "group", id: "tag1", children: [
    { kind: "heading", text: "공사 기초금액" },
    { kind: "table", children: [
      { kind: "tableBody", children: [
        { kind: "row", children: [
          { kind: "label", children: [{ kind: "text", text: "입찰공고번호" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.bidPbancNoPbancOrd" }] },
          { kind: "label", children: [{ kind: "text", text: "개찰일시" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.onbsPrnmntDt" }] },
        ] },
        { kind: "row", children: [
          { kind: "label", children: [{ kind: "text", text: "공고명" }] },
          { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.bidPbancNm" }] },
        ] },
      ] },
    ] },
    { kind: "table", children: [
      { kind: "tableBody", children: [
        { kind: "row", id: "baseAmtTag1", children: [
          { kind: "label", children: [{ kind: "text", text: "예비가격 기초금액" }] },
          { kind: "cell", colSpan: 4, children: [
            { kind: "list", children: [
              { kind: "item", children: [
                { kind: "paragraph", children: [{ kind: "text", text: "예비가격 기초금액 정보입니다." }] },
              ] },
            ] },
          ] },
        ] },
        { kind: "row", id: "baseAmtTag2", children: [
          { kind: "label", children: [{ kind: "text", text: "업종1코드" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.odn1MindCd" }] },
          { kind: "label", children: [{ kind: "text", text: "업종1금액" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.odn1MindAmt", digits: 0 }] },
        ] },
        { kind: "row", id: "baseAmtTag3", children: [
          { kind: "label", children: [{ kind: "text", text: "업종2코드" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.odn2MindCd" }] },
          { kind: "label", children: [{ kind: "text", text: "업종2금액" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.odn2MindAmt", digits: 0 }] },
        ] },
        { kind: "row", id: "baseAmtTag4", children: [
          { kind: "label", children: [{ kind: "text", text: "업종3코드" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.odn3MindCd" }] },
          { kind: "label", children: [{ kind: "text", text: "업종3금액" }] },
          { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.odn3MindAmt", digits: 0 }] },
        ] },
        { kind: "row", id: "baseAmtTag", children: [
          { kind: "label", children: [{ kind: "text", text: "예비가격 기초금액" }] },
          { kind: "cell", colSpan: 4, children: [
            { kind: "text", binding: "dlBsisAmtRM.bsamt" },
            { kind: "text", text: "원" },
          ] },
        ] },
        { kind: "row", id: "bsamtPcspTag", children: [
          { kind: "label", children: [{ kind: "text", text: "예비가격 기초금액<br/>중 순공사원가" }] },
          { kind: "cell", colSpan: 4, children: [
            { kind: "text", binding: "dlBsisAmtRM.bsamtPcsp", digits: 0 },
            { kind: "text", text: "원" },
            { kind: "item", children: [
              { kind: "paragraph", children: [{ kind: "text", text: "⁕ 기초금액 중 재료비·노무비·경비 및 이에 대한 부가가치세를 합산한 금액입니다." }] },
            ] },
          ] },
        ] },
        { kind: "row", id: "percentageTag", children: [
          { kind: "label", children: [{ kind: "text", text: "예비가격" }] },
          { kind: "cell", colSpan: 4, children: [{ kind: "text", binding: "dlBsisAmtM.sign2" }] },
        ] },
        { kind: "table", id: "grpQlemMatr", children: [
          { kind: "row", children: [
            { kind: "label", rowSpan: 10, children: [{ kind: "text", text: "적격심사사항" }] },
            { kind: "label", id: "ainfoTag", hidden: true, children: [{ kind: "text", text: "A" }] },
            { kind: "cell", id: "ainfoTag2", hidden: true, colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.aamtinfosumamt", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "cell", id: "ainfoTag3", colSpan: 4, children: [
              { kind: "list", children: [
                { kind: "item", children: [
                  { kind: "paragraph", children: [{ kind: "text", text: "A 란?" }] },
                  { kind: "list", children: [
                    { kind: "item", children: [
                      { kind: "text", text: "국민연금보험료,국민건강보험료,퇴직공제부금비,노인장기요양보험료,산업안전보건관리비" },
                      { kind: "text", id: "quality1", hidden: true, text: ", 안전관리비,품질관리비의 합산액" },
                    ] },
                  ] },
                ] },
              ] },
            ] },
          ] },
          { kind: "row", id: "grpScsbdLwlmRat", hidden: true, children: [
            { kind: "label", children: [{ kind: "text", text: "낙찰하한율" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.scsbdLwlmRat" },
              { kind: "text", text: "%" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "난이도계수" }] },
            { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.lvdfCfct" }] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "기타경비기준율" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.etcEpnsCrtrRat" },
              { kind: "text", text: "%" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "일반관리비기준율" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.gnrlMgcsCrtrRat" },
              { kind: "text", text: "%" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "이윤기준율" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.prftCrtrRat" },
              { kind: "text", text: "%" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "노무비기준율" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.lbrcCrtrRat" },
              { kind: "text", text: "%" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "cell", colSpan: 4, children: [
              { kind: "list", children: [
                { kind: "item", children: [
                  { kind: "paragraph", id: "bidInstTag1", children: [{ kind: "text", text: "※ 공사는 조달청 시설공사 적격심사세부기준 \"자재및인력조달가격 적정성 평가기준\"에 따라  기준율을 산출하고 평가 됩니다." }] },
                ] },
                { kind: "item", children: [
                  { kind: "paragraph", id: "bidInstTag2", children: [{ kind: "text", text: "※ 본 공사는 지방자치단체 시설공사 적격심사세부기준 \"자재및인력조달가격 적정성 평가기준\"에 따라 기준율을 산출하고 평가 됩니다." }] },
                ] },
                { kind: "item", children: [
                  { kind: "paragraph", id: "bidInstTag3", children: [{ kind: "text", text: "※ 제경비 적정성 평가의 적용률은 예비가격기초금액 작성시 적용률로 평가" }] },
                ] },
              ] },
            ] },
          ] },
          { kind: "row", id: "evlcrtAmtTag", children: [
            { kind: "label", children: [{ kind: "text", text: "평가기준금액" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.evlcrtAmt", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "evlcrtAmtTag2", children: [
            { kind: "label", children: [{ kind: "text", text: "난이도계수" }] },
            { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.lvdfCfct" }] },
          ] },
        ] },
      ] },
    ] },
    { kind: "table", id: "chkDtAfter", children: [
      { kind: "row", children: [
        { kind: "label", rowSpan: 24, children: [{ kind: "text", text: "참고사항" }] },
        { kind: "cell", colSpan: 4, children: [
          { kind: "list", children: [
            { kind: "item", id: "lisBid1", children: [
              { kind: "text", text: "입찰에 부치는 최종 물량내역서의 파일명은 " },
              { kind: "text", text: " ", binding: "dlBsisAmtRM.nsoiFileNm" },
              { kind: "text", text: " 입니다." },
            ] },
            { kind: "item", id: "lisBid2", children: [
              { kind: "paragraph", children: [{ kind: "text", text: "입찰자는 상기 물량내역서 여부를 반드시 확인하시기 바라며, 파일 확장자명이  .BID 인 경우 확장자명을 변경하여 투찰하여서는 아니됩니다." }] },
            ] },
            { kind: "item", id: "lisBid3", children: [
              { kind: "paragraph", children: [{ kind: "text", text: "법정경비, PS항목, 부가가치세등의 금액은 조달청에서 배부하는 물량내역서(공내역서)에 제시하는 내용대로 금액을 명기하여야 합니다." }] },
            ] },
            { kind: "item", children: [
              { kind: "paragraph", children: [{ kind: "text", text: "아래 법정비용은 \"법정요율\"과 \"직공비요율\"을 적용하여 첨부된 '법정경비 산정기준'에 따라 관계법령에서 요구하는 금액 이상으로 입찰내역서에 반영하시기 바랍니다." }] },
            ] },
          ] },
        ] },
      ] },
      { kind: "row", children: [
        { kind: "label", colSpan: 4, children: [{ kind: "text", text: "공사기초금액의 참고사항 (법정요율, 직공비요율) 정보입니다." }] },
      ] },
      { kind: "row", children: [
        { kind: "cell", children: [{ kind: "text", text: "법정요율(%)" }] },
        { kind: "cell", children: [{ kind: "text", text: "직공비요율(%)" }] },
      ] },
      { kind: "row", id: "safertyMycost", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "산업안전보건관리비" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.safertyMycostRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.safertyMycostConstRatio" }] },
      ] },
      { kind: "row", id: "retireDeduct", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "퇴직공제부금비" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.retireDeductRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.retireDeductConstRatio" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "환경보전비" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.environConservRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.environConservConstRatio" }] },
      ] },
      { kind: "row", id: "subctPymtWbond", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "하도급대금지급보증수수료" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.subctPymtWbondRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.subctPymtConstRatio" }] },
      ] },
      { kind: "row", id: "conequPymtWbond", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "건설기계대여지급보증수수료" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.conequPymtWbondRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.conequPymtConstRatio" }] },
      ] },
      { kind: "row", id: "induAccident", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "산업재해보상보험료" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.induAccidentRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.induAccidentConstRatio" }] },
      ] },
      { kind: "row", id: "emplInsu", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "고용보험료" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.emplInsuRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.emplInsuConstRatio" }] },
      ] },
      { kind: "row", id: "asbContrAmt", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "석면피해구제분담금" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.asbContrAmtRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.asbContrAmtConstRatio" }] },
      ] },
      { kind: "row", id: "wagBondAltm", children: [
        { kind: "label", colSpan: 2, children: [{ kind: "text", text: "임금채권부담금" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.wagBondAltmRatio" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlRsvPrceBsislM.wagBondAltmConstRatio" }] },
      ] },
      { kind: "row", children: [
        { kind: "cell", colSpan: 4, children: [
          { kind: "list", children: [
            { kind: "item", id: "wbidMethod1", children: [
              { kind: "text", text: "국민연금보험료, 국민건강보험료, 퇴직공제부금비, 노인장기요양보험료, 산업안전보건관리비" },
              { kind: "text", id: "ppsSftyMgcsAprtTrgtTxt", text: ", 안전관리비" },
              { kind: "text", id: "ppsQltyMgcsAprtTrgtTxt", text: ", 품질관리비" },
              { kind: "text", id: "ppsSmkpSumAmtTrgtTxt", text: ", 표준시장단가" },
              { kind: "text", text: "는 아래의 금액을 <font color=\"red\">조정없이 입찰내역서에 반영</font>하시기 바랍니다." },
            ] },
            { kind: "item", id: "ppsSmkpSumAmtAprtTrgtTxt", children: [{ kind: "text", id: "span2", text: "입찰내역서 작성 시 세부공종단가가 표준시장단가만으로 이루어진 세부공종의 합계액은 <font color=\"red\">아래의 표준시장단가의 금액 이상으로 작성</font>하여야 합니다. <font color=\"red\">(위반 시 적격심사 점수 감점)</font>" }] },
            { kind: "item", id: "wbidMethod1a", children: [
              { kind: "text", id: "wbidMethod2", text: "아래 7개 항목의 합산금액(A)" },
              { kind: "text", text: "은 입찰가격 평가시 제외합니다." },
            ] },
            { kind: "item", id: "wbidMethod4", children: [
              { kind: "text", text: "국민건강보험료, 국민연금보험료, 노인장기요양보험료, 퇴직공제부금비, 산업안전보건관리비" },
              { kind: "text", id: "wbidMethod4a", text: ", 안전관리비 " },
              { kind: "text", text: "는 아래의 금액(퇴직공제부금비, 산업안전보건관리비의 경우 하단의 [PS(사후정산)안내문] 참고)을" },
              { kind: "text", text: "조정없이 입찰내역서에 반영" },
              { kind: "text", text: "하시기 바랍니다." },
            ] },
            { kind: "item", id: "wbidMethod5", children: [
              { kind: "text", text: "국민건강보험료, 국민연금보험료, 노인장기요양보험료, 퇴직공제부금비, 산업안전보건관리비" },
              { kind: "text", id: "wbidMethod5a", text: ", 안전관리비 " },
              { kind: "text", text: ", 품질관리비는 아래의 금액을" },
              { kind: "text", text: "조정없이 입찰내역서에 반영" },
              { kind: "text", text: "하시기 바랍니다." },
            ] },
            { kind: "item", id: "wbidMethod6", children: [
              { kind: "text", text: "국민건강보험료, 국민연금보험료, 노인장기요양보험료, 퇴직공제부금비, 산업안전보건관리비" },
              { kind: "text", id: "wbidMethod6a", text: ", 안전관리비 " },
              { kind: "text", text: "는 아래의 금액을 " },
              { kind: "text", text: "조정없이 입찰내역서에 반영" },
              { kind: "text", text: "하시기 바랍니다." },
            ] },
            { kind: "item", id: "wbidMethod7", children: [
              { kind: "text", text: "국민건강보험료, 국민연금보험료, 노인장기요양보험료, 퇴직공제부금비" },
              { kind: "text", id: "wbidMethod7a", text: ", 안전관리비" },
              { kind: "text", text: "는 아래의 금액(퇴직공제부금비의 경우 하단의 [PS(사후정산)안내문] 참고)을 " },
              { kind: "text", text: "조정없이 입찰내역서에 반영" },
              { kind: "text", text: "하시기 바랍니다." },
            ] },
            { kind: "item", id: "wbidMethod8", children: [
              { kind: "text", text: "국민건강보험료, 국민연금보험료, 노인장기요양보험료, 퇴직공제부금비" },
              { kind: "text", id: "wbidMethod8a", text: ", 안전관리비" },
              { kind: "text", text: "는 아래의 금액을 " },
              { kind: "text", text: "조정없이 입찰내역서에 반영" },
              { kind: "text", text: "하시기 바랍니다." },
            ] },
            { kind: "item", id: "wbidMethod9", children: [
              { kind: "text", text: "국민건강보험료, 국민연금보험료, 노인장기요양보험료" },
              { kind: "text", id: "wbidMethod9a", text: ", 안전관리비" },
              { kind: "text", text: "는 아래의 금액을 " },
              { kind: "text", text: "조정없이 입찰내역서에 반영" },
              { kind: "text", text: "하시기 바랍니다." },
            ] },
          ] },
        ] },
      ] },
      { kind: "row", id: "mrfnAnntPremTag", children: [
        { kind: "label", children: [{ kind: "text", text: "국민연금보험료" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.mrfnAnntPrem", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "mrfnHlthPremTag", children: [
        { kind: "label", children: [{ kind: "text", text: "국민건강보험료" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.mrfnHlthPrem", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "rtrfundCtTag", children: [
        { kind: "label", children: [{ kind: "text", text: "퇴직공제부금비" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.rtrfundCt", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "odpsLotmRcprPremTag", children: [
        { kind: "label", children: [{ kind: "text", text: "노인장기요양보험료" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.odpsLotmRcprPrem", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "sftyMgcsTag", children: [
        { kind: "label", children: [{ kind: "text", text: "산업안전보건관리비" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.sftyMgcs", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "sftyChckMgcsTag", children: [
        { kind: "label", children: [{ kind: "text", text: "안전관리비" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.sftyChckMgcs", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "qltyMgcsTag", children: [
        { kind: "label", children: [{ kind: "text", text: "품질관리비" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.qltyMgcs", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "smkpSumAmtTag", children: [
        { kind: "label", children: [{ kind: "text", text: "표준시장단가" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAinfoM.smkpSumAmt", digits: 0 },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "odn1AddMatrGrp", hidden: true, children: [
        { kind: "label", children: [{ kind: "text", text: "[소액공사 안내문]" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.odn1AddMatr" }] },
      ] },
      { kind: "row", id: "odn2AddMatrGrp", hidden: true, children: [
        { kind: "label", children: [{ kind: "text", text: "[PS(사후정산) 안내문]" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.odn2AddMatr" }] },
      ] },
    ] },
    { kind: "group", id: "chkDtbefore", children: [
      { kind: "table", children: [
        { kind: "tableBody", children: [
          { kind: "row", children: [
            { kind: "label", rowSpan: 12, children: [{ kind: "text", text: "참고사항" }] },
            { kind: "cell", colSpan: 4, children: [
              { kind: "list", children: [
                { kind: "item", children: [
                  { kind: "text", text: "입찰에 부치는 최종 물량내역서의 파일명은" },
                  { kind: "text", text: "xxxx " },
                  { kind: "text", text: "입니다." },
                ] },
                { kind: "item", children: [
                  { kind: "paragraph", children: [{ kind: "text", text: "입찰자는 상기 물량내역서 여부를 반드시 확인하시기 바라며, 파일 확장자명이  .BID 인 경우 확장자명을 변경하여 투찰하여서는 아니됩니다." }] },
                ] },
                { kind: "item", children: [
                  { kind: "paragraph", children: [{ kind: "text", text: "법정경비, PS항목, 부가가치세등의 금액은 조달청에서 배부하는 물량내역서(공내역서)에 제시하는 내용대로 금액을 명기하여야 합니다." }] },
                ] },
                { kind: "item", children: [
                  { kind: "paragraph", children: [{ kind: "text", text: "아래 법정비용은 관계법령에서 요구하는 금액이상으로 입찰내역서에 반영하시기 바랍니다." }] },
                ] },
              ] },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "산업안전보건관리비" }] },
            { kind: "cell", colSpan: 4, children: [
              { kind: "text", binding: "dlBsisAmtRM.sftyMgcs", digits: 0 },
              { kind: "text", text: "원 X 투찰률이상 반영 " },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "퇴직공제부금비" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.rtrfundCt", digits: 0 },
              { kind: "text", text: "원 X 투찰률이상 반영 " },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "환경보전비" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.evrmPsvc", digits: 0 },
              { kind: "text", text: "원 X 투찰률이상 반영 " },
            ] },
          ] },
          { kind: "row", id: "sbrtPyprGrnteTag", children: [
            { kind: "label", children: [{ kind: "text", text: "하도급대금지급보증수수료" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.sbrtPyprGrnteFee", digits: 0 },
              { kind: "text", text: "원 X 투찰률이상 반영 " },
            ] },
          ] },
          { kind: "row", id: "mrfnHlthTag", children: [
            { kind: "label", children: [{ kind: "text", text: "국민건강보험료" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.mrfnHlthPrem", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "mrfnAnntTag", children: [
            { kind: "label", children: [{ kind: "text", text: "국민연금보험료" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.mrfnHlthPrem", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "label", children: [{ kind: "text", text: "노인장기요양보험료" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAmtRM.odpsLotmRcprPrem", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", children: [
            { kind: "cell", colSpan: 4, children: [
              { kind: "list", children: [
                { kind: "item", children: [
                  { kind: "paragraph", children: [{ kind: "text", text: "입찰내역서 작성시 법정비용중 투찰률 이상 반영에 대하여는 기초금액을 대비한 금액임" }] },
                  { kind: "list", children: [
                    { kind: "item", children: [
                      { kind: "paragraph", children: [{ kind: "text", text: "투찰률 = 투찰금액 / 예비가격기초금액" }] },
                    ] },
                  ] },
                ] },
              ] },
            ] },
          ] },
          { kind: "row", id: "add1", children: [
            { kind: "cell", colSpan: 4, children: [
              { kind: "list", children: [{ kind: "text", binding: "dlBsisAmtRM.odn1AddMatr" }] },
            ] },
          ] },
          { kind: "row", id: "add2", children: [
            { kind: "cell", colSpan: 4, children: [
              { kind: "list", children: [{ kind: "text", binding: "dlBsisAmtRM.odn2AddMatr" }] },
            ] },
          ] },
        ] },
      ] },
    ] },
    { kind: "group", id: "chkDtbefore2", children: [
      { kind: "table", children: [
        { kind: "tableBody", children: [
          { kind: "row", children: [
            { kind: "label", rowSpan: 12, children: [{ kind: "text", text: "참고사항" }] },
            { kind: "cell", id: "bidInst", colSpan: 4, children: [
              { kind: "list", children: [
                { kind: "item", id: "bidInst1", children: [
                  { kind: "text", text: "국민연금보험료, 국민건강보험료, 퇴직공제부금비, 노인장기요양보험료, 산업안전보건관리비" },
                  { kind: "text", id: "sftyMgcsAprtTrgtTxt", text: ", 안전관리비" },
                  { kind: "text", id: "qltyMgcsAprtTrgtTxt", text: ", 품질관리비" },
                  { kind: "text", text: "는 아래의 금액을 <font color=\"red\">조정 없이 입찰내역서에 반영</font>하시기 바랍니다." },
                ] },
                { kind: "item", id: "bidInst1a", children: [{ kind: "text", text: "입찰내역서 작성 시 세부공종단가가 표준시장단가만으로 이루어진 세부공종의 합계액은 <font color=\"red\">아래의 표준시장단가의 금액 이상으로 작성</font>하여야 합니다. <font color=\"red\">(위반 시 적격심사 점수 감점)</font>" }] },
                { kind: "item", id: "group1", children: [{ kind: "text", id: "aCntTxt", text: "아래 8개 항목의 합산 금액(A)은 입찰가격 평가 시 제외합니다." }] },
              ] },
            ] },
          ] },
          { kind: "row", id: "bidInstA", children: [
            { kind: "label", colSpan: 4, children: [{ kind: "text", text: "[A 정보]" }] },
          ] },
          { kind: "row", id: "natAnnuityIns", children: [
            { kind: "label", children: [{ kind: "text", text: "국민연금보험료" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.mrfnAnntPrem", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "natHealthIns", children: [
            { kind: "label", children: [{ kind: "text", text: "국민건강보험료" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.mrfnHlthPrem", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "retireDeductPremium", children: [
            { kind: "label", children: [{ kind: "text", text: "퇴직공제부금비" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.rtrfundCt", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "silverLongCareIns", children: [
            { kind: "label", children: [{ kind: "text", text: "노인장기요양보험료" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.odpsLotmRcprPrem", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "safertyMacost", children: [
            { kind: "label", children: [{ kind: "text", text: "산업안전보건관리비" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.sftyMgcs", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "sftyChckMgcsT", children: [
            { kind: "label", children: [{ kind: "text", text: "안전관리비" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.sftyChckMgcs", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "qltyMgcsT", children: [
            { kind: "label", children: [{ kind: "text", text: "품질관리비" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.qltyMgcs", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "sftyChckMgcsTqltyMgcsT", children: [
            { kind: "label", children: [{ kind: "text", text: "안전관리비+품질관리비" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.sftyChckMgcs", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "smkpSumAmtT", children: [
            { kind: "label", children: [{ kind: "text", text: "표준시장단가" }] },
            { kind: "cell", colSpan: 3, children: [
              { kind: "text", binding: "dlBsisAinfoM.smkpSumAmt", digits: 0 },
              { kind: "text", text: "원" },
            ] },
          ] },
          { kind: "row", id: "add3", children: [
            { kind: "cell", colSpan: 4, children: [
              { kind: "list", children: [{ kind: "text", binding: "dlBsisAmtRM.odn1AddMatr" }] },
            ] },
          ] },
          { kind: "row", id: "add4", children: [
            { kind: "cell", colSpan: 4, children: [
              { kind: "list", children: [{ kind: "text", binding: "dlBsisAmtRM.odn2AddMatr" }] },
            ] },
          ] },
        ] },
      ] },
    ] },
    { kind: "table", id: "grpSttyEpnsCmpuBais", children: [
      { kind: "tableBody", children: [
        { kind: "row", children: [
          { kind: "label", children: [{ kind: "text", text: "첨부파일" }] },
          { kind: "cell", colSpan: 3, children: [
            { kind: "download", id: "btnSttyEpnsCmpuBais", text: "법정경비 산정기준" },
            { kind: "download", id: "btnInvsAmtAdjsSmrs", text: "조사금액조정 사유서" },
          ] },
        ] },
      ] },
    ] },
  ] },
  { kind: "group", id: "prcmBsneSe5", children: [
    { kind: "heading", text: "공고일반-기초금액" },
  ] },
  { kind: "group", id: "prcmBsneSe6", children: [
    { kind: "table", children: [
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "입찰공고번호" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.bidPbancNo" }] },
        { kind: "label", children: [{ kind: "text", text: "개찰일시" }] },
        { kind: "cell", children: [{ kind: "text", binding: "dlBsisAmtRM.onbsPrnmntDt" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "입찰공고명" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.bidPbancNm" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "참조번호" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.usrDocNoVal" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "공고기관" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.pbancInstUntyGrpNm" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "수요기관" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.dmstNm" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "기초금액" }] },
        { kind: "cell", colSpan: 3, children: [
          { kind: "text", binding: "dlBsisAmtRM.bsamt" },
          { kind: "text", text: "원" },
        ] },
      ] },
      { kind: "row", id: "sign03", children: [
        { kind: "label", children: [{ kind: "text", text: "예비가격" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", id: "sign3", binding: "dlBsisAmtM.sign3" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "참고사항1" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.odn1AddMatr" }] },
      ] },
      { kind: "row", children: [
        { kind: "label", children: [{ kind: "text", text: "참고사항2" }] },
        { kind: "cell", colSpan: 3, children: [{ kind: "text", binding: "dlBsisAmtRM.odn2AddMatr" }] },
      ] },
    ] },
  ] },
  { kind: "posts" },
];

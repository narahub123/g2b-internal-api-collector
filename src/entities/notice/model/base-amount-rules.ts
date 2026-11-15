import { baseAmountLayout } from "./base-amount-layout";
import { formatG2bDisplayNumber } from "@/shared/lib/g2b/g2b-display-format";

type Scalar = string | number | boolean;
type DataMap = Map<string, Scalar>;

const isEmpty = (value: Scalar | undefined) => value === undefined || value === "";
const formatAmount = (value: Scalar) => formatG2bDisplayNumber(String(value ?? "").replace(/,/g, ""), 3);

function reservePriceText(code: unknown, rate: unknown) {
  const sign = code === "예070003" ? "±" : code === "예070001" ? "+" : code === "예070002" ? "-" : "";
  if (sign) return `기초금액기준 ${sign} ${rate ?? ""}% 범위 내에서 작성됩니다.`;
}

// 건설기계대여금 보증 요율이 모두 양수인 국가계약 공고는 Y2 이전에 New 양식을 사용한다.
function getStandardFilename(
  constructionEquipment: boolean, national: boolean, retirement: Scalar,
  postedAt: Scalar, safety: boolean, quality: boolean,
) {
  if (retirement === "Y2") {
    if (String(postedAt ?? "") >= "20260313000000") return "Cost_Standard_New_20260313.hwp";
    if (quality) return "Cost_Standard_New_20200910.hwp";
    return safety ? "Cost_Standard_New_20190604.hwp" : "Cost_Standard_New_20190101.hwp";
  }
  const nationalEquipment = constructionEquipment && national;
  if (!nationalEquipment && !["N", "N2", "Y1"].includes(String(retirement))) return;
  if (safety) return "Cost_Standard_New_20190604.hwp";
  if (nationalEquipment || retirement === "N2" || (constructionEquipment && retirement === "N")) {
    return "Cost_Standard_New.hwp";
  }
  return retirement === "N" ? "Cost_Standard.hwp" : "Cost_Standard_New_20181201.hwp";
}

/** 금액을 네 자리 단위로 나눠 원본 표의 한글 금액 표시값을 구성한다. */
export function formatKoreanAmount(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "";
  const [, sign, integer, fraction] = match;
  const digits = "영일이삼사오육칠팔구";
  const places = ["천", "백", "십", ""];
  const units = ["", "만", "억", "조", "경", "해", "자", "양", "구", "간", "정", "재", "극"];
  let result = "";
  for (let end = integer.length, unit = 0; end > 0; end -= 4, unit++) {
    const group = integer.slice(Math.max(0, end - 4), end).padStart(4, "0");
    const reading = [...group].map((digit, index) =>
      digit === "0" ? "" : digits[Number(digit)] + places[index],
    ).join("");
    if (reading) result = reading + (units[unit] ?? "") + result;
  }
  return (sign ? "마이너스 " : "") + (result || "영") +
    (fraction ? "점" + [...fraction].map((digit) => digits[Number(digit)]).join("") : "");
}

/**
 * 원본 화면의 초기 상태와 업무구분별 변경을 순서대로 적용한다.
 * 전달된 데이터맵은 표시 전용 복사본이며 계산된 표시값을 여기에 기록한다.
 */
export function applyBaseAmountRules(
  dlBsisAmtRM: DataMap,
  dlBsisAmtM: DataMap,
  dlBsisAinfoM: DataMap,
  dlRsvPrceBsislM: DataMap,
  rows: Record<string, unknown>[],
) {
  const visibility = new Map<string, boolean>();
  const labels = new Map<string, string>();
  const text = new Map<string, string>();
  const indexLayout = (nodes: typeof baseAmountLayout) => {
    for (const node of nodes) {
      if (node.id && node.hidden) visibility.set(node.id, false);
      if (node.id && node.text) labels.set(node.id, node.text);
      if (node.children) indexLayout(node.children);
    }
  };
  indexLayout(baseAmountLayout);
  const hide = (id: string) => visibility.set(id, false);
  const show = (id: string) => visibility.set(id, true);
  const isShown = (id: string) => visibility.get(id) !== false;
  const setText = (id: string, value: string | number) => text.set(id, String(value));
  const getText = (id: string) => text.get(id) ?? labels.get(id) ?? "";
  let standardFilename: string | undefined;

  const bidPbancNo = dlBsisAmtRM.get("bidPbancNo") ?? "";
  const bidPbancOrd = dlBsisAmtRM.get("bidPbancOrd") ?? "";
  const bidPbancNm = dlBsisAmtRM.get("bidPbancNm") ?? "";
  const prcmBsneSeCd = dlBsisAmtRM.get("prcmBsneSeCd");
  const percentageYn = dlBsisAmtRM.get("percentageYn");                                 //예가산출범위 표시 여부
  const sttrEpnsCmpuTarfLst = dlBsisAmtRM.get("sttrEpnsCmpuTarfLst");                   //법정경비산정요율목록
  const bsamtPcsp = dlBsisAmtRM.get("bsamtPcsp");                                       //기초금액순공사비
  const isPureConstExpsTrget = dlBsisAmtRM.get("isPureConstExpsTrget");                 //순공사비 여부
  const lcrtTyCd = dlBsisAmtRM.get("lcrtTyCd");                                         //계약법유형코드
  const isConstBidOfNewQlfdJudgeYn = dlBsisAmtRM.get("isConstBidOfNewQlfdJudgeYn");     //A정보 여부
  const pbancInstCd = dlBsisAmtRM.get("pbancInstCd");                                   //공고기관코드
  const matlMnpwQlfdYn = dlBsisAmtRM.get("matlMnpwQlfdYn");                             //자재및인력조달가격 적정성 평가기준(적격성심사 대상 낙찰방법코드 여부)
  const retirAndSafeYn = dlBsisAmtRM.get("retirAndSafeYn");                             //최초공고게시일확인
  const isBaseAmtDtOverYn = dlBsisAmtRM.get("isBaseAmtDtOverYn");                       //결재일자체크
  const subctpymtwbondfeeYn = dlBsisAmtRM.get("subctpymtwbondfeeYn");   //하도급대금지급보증수수료 표시 여부
  const scsbdMthdCd = dlBsisAmtRM.get("scsbdMthdCd");                   // 낙찰방법코드
  const wbidLowestRateBtnYn = dlBsisAmtRM.get("wbidLowestRateBtnYn");   // 낙찰하한율버튼 표시여부
  const qualityMacostATrgetBidYn = dlBsisAmtRM.get("qualityMacostATrgetBidYn");                 //품질관리비 A적용대상 공고여부
  const qualityMacostInputSpuseComptYn = dlBsisAmtRM.get("qualityMacostInputSpuseComptYn");     //품질관리비 입력항목 별도구성여부
  const qltyMgcsAprtTrgtYn = dlBsisAmtRM.get("qltyMgcsAprtTrgtYn");     // 품질관리비계상대상여부
  const sftyMgcsAprtTrgtYn = dlBsisAmtRM.get("sftyMgcsAprtTrgtYn");     // 안전관리비계상대상여부
  const faciNtrgtCrtrAplcnYn = dlBsisAmtRM.get("faciNtrgtCrtrAplcnYn"); // 건설산업기본법(비대상)기준적용여부
  const faciAplcnYn = dlBsisAmtRM.get("faciAplcnYn");                   // 건설산업기본법적용여부
  const cltptyCstrnLmtYn = dlBsisAmtRM.get("cltptyCstrnLmtYn");         // 문화재공사제한여부
  const srvcePrdctCmplsYn = dlBsisAmtRM.get("srvcePrdctCmplsYn");       // 일반용역물품필수여부
  
  const smkpSumAmtTrgetYn = dlBsisAmtRM.get("smkpSumAmtTrgetYn");       // 표준시장단가대상여부
  const asbWagSttrEpnsTrgetYn = dlBsisAmtRM.get("asbWagSttrEpnsTrgetYn");       // 석면임금법정경비대상여부

  hide("taskClCd1");   //물품 공고정보 숨김
  hide("taskClCd2");   //물품 공고정보 숨김
  hide("taskClCd3");   //물품 기초금액 숨김
  hide("taskClCd4");   //물품 기초금액 숨김
  hide("taskClCd5");   //물품 예비가격 숨김
  hide("taskClCd6");   //물품 예비가격 숨김

  hide("add3");
  hide("add4");

  hide("prcmBsneSe5");
  hide("prcmBsneSe6");
  hide("isNegotiationTag");  //유의사항 숨김
  setText("bidInfo", `입찰공고번호 ${bidPbancNo} - ${bidPbancOrd} 호 ${bidPbancNm} 입찰의 기초금액은 다음과 같습니다.`);

  //목록 게시물 개수 셋팅
  setText("tbxExmnItemTotCnt", rows.length);

  if (prcmBsneSeCd === "01" || (prcmBsneSeCd === "03" && srvcePrdctCmplsYn === "Y") ) {
      hide("tag1");        //공사기초금액 정보 숨김
      show("taskClCd1");
      show("taskClCd2");
      show("taskClCd3");
      show("taskClCd4");
      show("taskClCd5");
      show("taskClCd6");
      if (dlBsisAmtRM.get("isNegotiation") === "true") {//협상에 의한 계약인 경우
          show("isNegotiationTag");
      }

      dlBsisAmtM.set("sign", reservePriceText(rows[0]?.rsvePrceRangSeCd, rows[0]?.prceCrtRangRt));

  } else if (prcmBsneSeCd === "07") { // 공사인 경우

      const bsamt = String(dlBsisAmtRM.get("bsamt") ?? "").replace(/,/gi, "");  // 예비가격 기초금액
      const kornBsamt = formatAmount(dlBsisAmtRM.get("bsamt")) + "   ( " + formatKoreanAmount(bsamt) + " )";
      dlBsisAmtRM.set("bsamt", kornBsamt);

      const prceCrtRangRt = dlBsisAmtRM.get("prceCrtRangRt");
      const rsvePrceRangSeCd = dlBsisAmtRM.get("rsvePrceRangSeCd");
      const inptDt = dlBsisAmtRM.get("inptDt");
      const odn1AddMatr = dlBsisAmtRM.get("odn1AddMatr");
      const odn2AddMatr = dlBsisAmtRM.get("odn2AddMatr");

      //예비가격 업종코드 정보 숨김
      hide("baseAmtTag");
      hide("baseAmtTag1");
      hide("baseAmtTag2");
      hide("baseAmtTag3");
      hide("baseAmtTag4");

      hide("bsamtPcspTag");            //예비가격 기초금액중 순공사원가 숨김처리
      hide("percentageTag");          //예비가격 숨김처리
      hide("ainfoTag3");
      hide("evlcrtAmtTag");           //적격심사사항 평가기준금액 숨김
      hide("evlcrtAmtTag2");          //적격심사사항 난이도계수 숨김
      hide("grpSttyEpnsCmpuBais");
      hide("btnInvsAmtAdjsSmrs");

      if (dlBsisAmtRM.get("basePdamtYn") === "true") {
          show("baseAmtTag");             //예비가격  정보 보이기
      } else {
          show("baseAmtTag1");            //예비가격 기초금액 보이기
          show("baseAmtTag2");            //예비가격 기초금액 보이기
          show("baseAmtTag3");            //업종코드 보이기
          show("baseAmtTag4");            //업종코드 보이기
      }
      //순공사비 여부 Y 이고 순공사비가 널이 아닌경우
      if(lcrtTyCd === "계040003"){
          if(Number(bsamtPcsp ?? 0) !== 0){
              show("bsamtPcspTag");
          }
      }else{
          if (isPureConstExpsTrget === "Y" && !isEmpty(bsamtPcsp)) {
              show("bsamtPcspTag");
          }
      }

      // 안정화기간 중 임의개찰한 건 조치
      // 자체 기준을 사용하는 공고는 순공사원가 표시 대상에서 제외한다.
      if (bidPbancNo === "20241233183") hide("bsamtPcspTag");

      if (percentageYn === "true" || percentageYn === "Y") {        //예가산출범위 표시 여부 true일때
          show("percentageTag");

          dlBsisAmtM.set("sign2", reservePriceText(rsvePrceRangSeCd, prceCrtRangRt));
      }

      // 2023. 10. 10. 시설사업국 토목환경과 변경요청 - 종합심사낙찰제(국가계약법) || 종합평가낙찰제(지방계약법)
      if((lcrtTyCd === "계040001" && scsbdMthdCd === "낙030011") || (lcrtTyCd === "계040002" && scsbdMthdCd === "낙030012")){
          hide("grpQlemMatr");
      }

      //A정보 조회 계040001 국가계약법  계040002 지방계약법 Dt20090201 이후
      if ((lcrtTyCd === "계040001" || dlBsisAmtRM.get("pps2267ApplyDtYn") === "true") || (lcrtTyCd === "계040002" || dlBsisAmtRM.get("chkDt20090201000000") === "true")) {

          //신규적격심사 대상 공고인지
          if (isConstBidOfNewQlfdJudgeYn === "Y") {
              show("ainfoTag");
              show("ainfoTag2");
              show("ainfoTag3");
              //품질관리비 A적용대상 공고여부에 따른 문구수정
              show("quality1");
              let quality1Txt = "";
              if (qltyMgcsAprtTrgtYn === "Y" || (qualityMacostATrgetBidYn === "Y" && qualityMacostInputSpuseComptYn === "Y")) {
                  dlBsisAinfoM.set("aamtinfosumamt", dlBsisAinfoM.get("aamtinfosumamt2"));
                  quality1Txt += ",품질관리비";
              }
              if(smkpSumAmtTrgetYn === "Y"){
                  quality1Txt += ",표준시장단가";
              }
              setText("quality1", ",안전관리비"+ quality1Txt +"의 합산액");

              // [건설산업기본법(비대상)기준 적용] 품질관리비, 안전관리비 항목 삭제 (단, 국가유산수리 공사 '대상' 공고는 적용대상에서 제외)
              if (dlBsisAinfoM.get("prcmMthoSeCd") === '조020001' && faciNtrgtCrtrAplcnYn === 'Y' && faciAplcnYn === 'N' && cltptyCstrnLmtYn === 'N') {
                  setText("quality1", getText("quality1").replace(",안전관리비",""));
                  setText("quality1", getText("quality1").replace(",품질관리비",""));
                  hide("sftyMgcsAprtTrgtTxt");
                  hide("qltyMgcsAprtTrgtTxt");
              }

              if(wbidLowestRateBtnYn === "Y"){
                  show("grpScsbdLwlmRat");
              }
          }

          if (lcrtTyCd === "계040001" && String(pbancInstCd).substring(0, 3) === "123" && matlMnpwQlfdYn === "true") {
              hide("bidInstTag2");
              hide("bidInstTag3");
          } else if (lcrtTyCd === "계040002" && String(pbancInstCd).substring(0, 3) === "123" && matlMnpwQlfdYn === "true") {
              hide("bidInstTag1");
              hide("bidInstTag3");
          } else {
              hide("bidInstTag1");
              hide("bidInstTag2");
          }
      }

      if (!((lcrtTyCd === "계040001" || dlBsisAmtRM.get("pps2267ApplyDtYn") === "true") || (lcrtTyCd === "계040002" || dlBsisAmtRM.get("chkDt20090201000000") === "true"))) {
          show("evlcrtAmtTag");
          show("evlcrtAmtTag2");
      }
      hide("chkDtAfter");     //2012년 04월 06 일 이후
      hide("chkDtbefore");     //2012년 04월 06 일 이전따른 참조사항 화면 변경
      hide("chkDtbefore2");
      if (String(pbancInstCd).substring(0, 3) === "123") {       //공고기관코드

          let valSplit: string[];
          if (dlBsisAmtRM.get("chkDt20120406000000") === "true") {//20120406 이후
              show("chkDtAfter");

              if (dlBsisAmtRM.get("lisBidYn") === "Y") {
                  show("lisBid1");
                  show("lisBid2");
                  show("lisBid3");
              } else {
                  hide("lisBid1");
                  hide("lisBid2");
                  hide("lisBid3");
              }
              valSplit = String(sttrEpnsCmpuTarfLst ?? "").split('|');
              if (sttrEpnsCmpuTarfLst !== "||||||||||||||" && sttrEpnsCmpuTarfLst !== "||||||||||||||||||") {
                  const safertyMycostAdd = valSplit[12];    //산업안전보건관리비 추가비용
                  const safertyMycostRat = valSplit[0];     //산업안전보건관리비 법정요율
                  if (retirAndSafeYn === "N" || retirAndSafeYn === 'N2' || retirAndSafeYn === 'Y1') {
                      if (Number(safertyMycostAdd) > 0) {
                          const safertyMycostRat2 = safertyMycostRat + " \r% \r\r\r " + formatAmount(safertyMycostAdd) + "\r 천원";
                          dlRsvPrceBsislM.set("safertyMycostRatio", safertyMycostRat2);
                          dlRsvPrceBsislM.set("safertyMycostConstRatio", valSplit[1]);          //산업안전보건관리비 직공비율
                      } else {
                          dlRsvPrceBsislM.set("safertyMycostRatio", valSplit[0]);               //산업안전보건관리비 법정요율
                          dlRsvPrceBsislM.set("safertyMycostConstRatio", valSplit[1]);          //산업안전보건관리비 직공비율
                      }
                  } else {
                      hide("safertyMycost");
                  }
                  if (retirAndSafeYn === "N" || retirAndSafeYn === 'N2') {
                      dlRsvPrceBsislM.set("retireDeductRatio", valSplit[2]);                //퇴직공제부금비_법정요율
                      dlRsvPrceBsislM.set("retireDeductConstRatio", valSplit[3]);           //퇴직공제부금비 직공비율
                  } else {
                      hide("retireDeduct");
                  }

                  dlRsvPrceBsislM.set("environConservRatio", valSplit[4]);               //환경보전비 법정요율
                  dlRsvPrceBsislM.set("environConservConstRatio", valSplit[5]);          //환경보전비 직공비율

                  dlRsvPrceBsislM.set("asbContrAmtRatio", valSplit[15]);              //석면분담금 법정요율
                  dlRsvPrceBsislM.set("asbContrAmtConstRatio", valSplit[16]);              //석면분담금 직공비율

                  dlRsvPrceBsislM.set("wagBondAltmRatio", valSplit[17]);              //임금채권부담금 법정요율
                  dlRsvPrceBsislM.set("wagBondAltmConstRatio", valSplit[18]);              //임금채권부담금 직공비율
              }
              if (!isEmpty(inptDt)) {
                  if (subctpymtwbondfeeYn === 'true') {
                      show("subctPymtWbond");
                      show("conequPymtWbond");
                      show("induAccident");
                      show("emplInsu");

                      dlRsvPrceBsislM.set("subctPymtWbondRatio", valSplit[6]);                //하도급대금지급보증 법정요율
                      dlRsvPrceBsislM.set("subctPymtConstRatio", valSplit[7]);                //하도급대금지급보증 직공비율

                      dlRsvPrceBsislM.set("conequPymtWbondRatio", valSplit[13]);              //건설기계대여지급보증 법정요율
                      dlRsvPrceBsislM.set("conequPymtConstRatio", valSplit[14]);              //건설기계대여지급보증 직공비율

                      dlRsvPrceBsislM.set("induAccidentRatio", valSplit[8]);                  //산업재해보상보험료 법정요율
                      dlRsvPrceBsislM.set("induAccidentConstRatio", valSplit[9]);             //산업재해보상보험료 직공비율

                      dlRsvPrceBsislM.set("emplInsuRatio", valSplit[10]);                     //고용보험료_법정요율
                      dlRsvPrceBsislM.set("emplInsuConstRatio", valSplit[11]);                //고용보험료 직공비율
                  }
              } else {
                  hide("subctPymtWbond");
                  hide("conequPymtWbond");
                  hide("induAccident");
                  hide("emplInsu");

              }
              if (asbWagSttrEpnsTrgetYn === 'Y') {                                    //석면임금채권 보이기
                  show("asbContrAmt");
                  show("wagBondAltm");
              } else {
                  hide("asbContrAmt");
                  hide("wagBondAltm");
              }


              hide("wbidMethod1");//참고사항 문구 숨기기
              hide("wbidMethod1a");//참고사항 문구 숨기기
              hide("wbidMethod4");//참고사항 문구 숨기기
              hide("wbidMethod4a");//참고사항 문구 숨기기
              hide("wbidMethod5");//참고사항 문구 숨기기
              hide("wbidMethod5a");//참고사항 문구 숨기기
              hide("wbidMethod6");//참고사항 문구 숨기기
              hide("wbidMethod6a");//참고사항 문구 숨기기
              hide("wbidMethod7");//참고사항 문구 숨기기
              hide("wbidMethod7a");//참고사항 문구 숨기기
              hide("wbidMethod8");//참고사항 문구 숨기기
              hide("wbidMethod8a");//참고사항 문구 숨기기
              hide("wbidMethod9");//참고사항 문구 숨기기
              hide("wbidMethod9a");//참고사항 문구 숨기기

              hide("mrfnHlthPremTag");    //국민건강보험료 숨기기
              hide("mrfnAnntPremTag");    //국민연금보험료 숨기기
              hide("rtrfundCtTag");       //퇴직공제부금비 숨기기
              hide("odpsLotmRcprPremTag");//노인장기요양보험료 숨기기
              hide("sftyMgcsTag");        //산업안전보건관리비  숨기기
              hide("sftyChckMgcsTag");    //안전관리비 숨기기
              hide("qltyMgcsTag");        //품질관리비 숨기기
              hide("smkpSumAmtTag");        //표준시장단가 숨기기
              hide("ppsSmkpSumAmtTrgtTxt");        //표준시장단가 숨기기
              hide("ppsSmkpSumAmtAprtTrgtTxt");    //표준시장단가 숨기기

              // 공사 && A적용 대상 낙찰방법 && 공통_공동코드.속성값 첫 자리가 Y
              if (isConstBidOfNewQlfdJudgeYn === 'Y' && dlBsisAmtRM.get("methodCdIsJdgmnClCdYn") === 'Y') {
                  show("mrfnHlthPremTag");    //국민건강보험료 보이기
                  show("mrfnAnntPremTag");    //국민연금보험료 보이기
                  show("rtrfundCtTag");       //퇴직공제부금비 보이기
                  show("odpsLotmRcprPremTag");//노인장기요양보험료 보이기
                  show("sftyMgcsTag");        //산업안전보건관리비  보이기
                  show("sftyChckMgcsTag");    //안전관리비 보이기

                  show("wbidMethod1");        //참고사항 문구 보이기
                  show("wbidMethod1a");        //참고사항 문구 보이기

                  if(smkpSumAmtTrgetYn === "Y"){
                      show("smkpSumAmtTag");        //표준시장단가 보이기
                      show("ppsSmkpSumAmtAprtTrgtTxt");//참고사항 문구 숨기기
                  }

                  if (qualityMacostATrgetBidYn === "N" && qualityMacostInputSpuseComptYn === "Y") {
                      if(smkpSumAmtTrgetYn === "Y"){
                          setText("wbidMethod2", "아래 품질관리비를 제외한 7개의 항목의 합산금액(A)");
                      }else{
                          setText("wbidMethod2", "아래 품질관리비를 제외한 6개의 항목의 합산금액(A)");
                      }
                  }else if (qualityMacostATrgetBidYn === "N" && qualityMacostInputSpuseComptYn === "N") {
                      hide("ppsQltyMgcsAprtTrgtTxt");//참고사항 문구 숨기기
                       if(smkpSumAmtTrgetYn === "Y"){
                          setText("wbidMethod2", "아래 7개의 항목의 합산금액(A)");
                       }else{
                          setText("wbidMethod2", "아래 6개의 항목의 합산금액(A)");
                       }
                  }else if(qualityMacostATrgetBidYn === "Y"){
                       if(smkpSumAmtTrgetYn === "Y"){
                          setText("wbidMethod2", "아래 8개의 항목의 합산금액(A)");
                       }else{
                          setText("wbidMethod2", "아래 7개 항목의 합산금액(A)");
                       }
                  }

                  if(qualityMacostInputSpuseComptYn === "Y"){
                      show("qltyMgcsTag");        //품질관리비 보이기
                  }

                  // [건설산업기본법(비대상)기준 적용] 품질관리비, 안전관리비 항목 삭제 (단, 국가유산수리 공사 '대상' 공고는 적용대상에서 제외)
                  if (dlBsisAinfoM.get("prcmMthoSeCd") === '조020001' && faciNtrgtCrtrAplcnYn === 'Y' && faciAplcnYn === 'N' && cltptyCstrnLmtYn === 'N') {
                       hide("sftyChckMgcsTag");    //안전관리비 숨기기
                       hide("qltyMgcsTag");        //품질관리비 숨기기
                       hide("ppsSftyMgcsAprtTrgtTxt");
                       hide("ppsQltyMgcsAprtTrgtTxt");
                       if(smkpSumAmtTrgetYn === "Y"){
                          setText("wbidMethod2", "아래 6개 항목의 합산금액(A)");
                       }else{
                          setText("wbidMethod2", "아래 5개 항목의 합산금액(A)");
                       }
                  }

              }else{

                  if (dlBsisAmtRM.get("natHealthInsYn") === 'true') {//국민건강보험료 표시 여부
                      if (retirAndSafeYn === 'Y2') {
                          if (isBaseAmtDtOverYn === 'N') {
                              show("wbidMethod4");                //참고사항 문구 보이기
                              if (sftyMgcsAprtTrgtYn === 'Y') {
                                  show("wbidMethod4a");           //참고사항 문구 보이기
                              }
                          } else {
                              if (qualityMacostInputSpuseComptYn === 'Y') {
                                  show("wbidMethod5");                //참고사항 문구 보이기
                                  if (sftyMgcsAprtTrgtYn === 'Y') {
                                      show("wbidMethod5a");           //참고사항 문구 보이기
                                  }
                              } else {
                                  show("wbidMethod6");                //참고사항 문구 보이기
                                  if (sftyMgcsAprtTrgtYn === 'Y') {
                                      show("wbidMethod6a");           //참고사항 문구 보이기
                                  }
                              }
                          }
                      }
                      if (retirAndSafeYn === 'Y1') {
                          if (isBaseAmtDtOverYn === 'N') {
                              show("wbidMethod7");                //참고사항 문구 보이기
                              if (sftyMgcsAprtTrgtYn === 'Y') {
                                  show("wbidMethod7a");           //참고사항 문구 보이기
                              }
                          } else {
                              show("wbidMethod8");                //참고사항 문구 보이기
                              if (sftyMgcsAprtTrgtYn === 'Y') {
                                  show("wbidMethod8a");           //참고사항 문구 보이기
                              }
                          }
                      }
                      if (retirAndSafeYn === 'N' || retirAndSafeYn === 'N2') {
                          show("wbidMethod9");                //참고사항 문구 보이기
                          if (sftyMgcsAprtTrgtYn === 'Y') {
                              show("wbidMethod9a");           //참고사항 문구 보이기
                          }
                      }
                      show("mrfnHlthPremTag");    //국민건강보험료 보이기
                      show("mrfnAnntPremTag");    //국민연금보험료 보이기
                  }
                  show("odpsLotmRcprPremTag");    //노인장기요양보험료 보이기

                  if ((retirAndSafeYn !== 'N' && retirAndSafeYn !== 'N2') && isBaseAmtDtOverYn === 'Y') {
                      if (retirAndSafeYn === 'Y1') {
                          show("rtrfundCtTag");       //퇴직공제부금비 보이기
                      }
                      if (retirAndSafeYn === 'Y2') {
                          show("rtrfundCtTag");       //퇴직공제부금비 보이기
                          show("sftyMgcsTag");        //산업안전보건관리비  보이기
                      }
                  }
                  if (dlBsisAmtRM.get("natHealthInsYn") === 'true' && retirAndSafeYn === 'Y2' && isBaseAmtDtOverYn !== 'N' && qualityMacostInputSpuseComptYn === 'Y') {//국민건강보험료 표시 여부
                      show("sftyChckMgcsTag");    //안전관리비 보이기
                      show("qltyMgcsTag");        //품질관리비 보이기
                  }
                  // [건설산업기본법(비대상)기준 적용] 품질관리비, 안전관리비 항목 삭제 (단, 국가유산수리 공사 '대상' 공고는 적용대상에서 제외)
                  if (dlBsisAinfoM.get("prcmMthoSeCd") === '조020001' && faciNtrgtCrtrAplcnYn === 'Y' && faciAplcnYn === 'N' && cltptyCstrnLmtYn === 'N') {
                      hide("sftyChckMgcsTag");    //안전관리비 숨기기
                      hide("qltyMgcsTag");        //품질관리비 숨기기
                  }
              }

              // 법정경비 산정기준 보이기
              show("grpSttyEpnsCmpuBais");

              standardFilename = getStandardFilename(
                  Number(valSplit[13]) > 0 && Number(valSplit[14]) > 0,
                  lcrtTyCd === "계040001",
                  retirAndSafeYn,
                  dlBsisAinfoM.get("pbancPstgDt"),
                  sftyMgcsAprtTrgtYn === "Y",
                  qltyMgcsAprtTrgtYn === "Y" || qualityMacostInputSpuseComptYn === "Y",
              );

              // 조사금액조정 사유서
              if(!isEmpty(dlBsisAmtRM.get("adjsSmrsAtchFileSqno"))){
                  show("btnInvsAmtAdjsSmrs");
              }

              if (!isEmpty(odn1AddMatr)) {
                  show("odn1AddMatrGrp");    //추가사항 1
              }
              if (!isEmpty(odn2AddMatr)) {
                  show("odn2AddMatrGrp");    //추가사항 2
              }
          }

          //2012년 04월 06 일 이전 시작
          if (dlBsisAmtRM.get("chkDt20120406000000") === "false") {

              hide("sbrtPyprGrnteTag");
              hide("mrfnHlthTag");
              hide("mrfnAnntTag");
              hide("add1");    //추가사항 1
              hide("add2");    //추가사항 2
              show("chkDtbefore");     //2012년 04월 06 일 이전따른 참조사항 화면 변경
              if (dlBsisAmtRM.get("lisBidYn") === "Y") {
                  show("lisBid1");
                  show("lisBid2");
                  show("lisBid3");
              } else {
                  hide("lisBid1");
                  hide("lisBid2");
                  hide("lisBid3");

              }
              if (!isEmpty(inptDt)) {
                  if (subctpymtwbondfeeYn === 'true') {   //하도급대금지급보증수수료 표시 여부
                      show("sbrtPyprGrnteTag");
                  }
                  if (dlBsisAmtRM.get("natHealthInsYn") === 'true') {//국민건강보험료 표시 여부
                      show("mrfnHlthTag");
                      show("mrfnAnntTag");
                  }
              }
              if (!isEmpty(odn1AddMatr)) {
                  show("add1");    //추가사항 1
              }
              if (!isEmpty(odn2AddMatr)) {
                  show("add2");    //추가사항 2
              }
          }
      }

      // 조달청 공고가 아닐 경우
      if (String(pbancInstCd).substring(0, 3) !== "123") {       //공고기관코드
          if (!isEmpty(odn1AddMatr) || !isEmpty(odn2AddMatr) || isConstBidOfNewQlfdJudgeYn === 'Y') {
              show("chkDtbefore2"); //참고사항 숨김
              hide("bidInstA");
              hide("bidInst");
              hide("bidInst1");
              hide("bidInst1a");
              hide("qltyMgcsAprtTrgtTxt");

              hide("natAnnuityIns");              //국민연금보험료
              hide("natHealthIns");               //국민건강보험료
              hide("retireDeductPremium");        //퇴직공제부금비
              hide("silverLongCareIns");          //노인장기요양보험료
              hide("safertyMacost");              //산업안전보건관리비

              hide("sftyChckMgcsT");              //안전관리비
              hide("qltyMgcsT");                  //품질관리비
              hide("sftyChckMgcsTqltyMgcsT");     //안전관리비+품질관리비
              hide("smkpSumAmtT");                  //표준시장단가

              let aCnt = 6;
              if (isConstBidOfNewQlfdJudgeYn === "Y") {
                  if (matlMnpwQlfdYn === "true") {
                      if (dlBsisAmtRM.get("methodCdIsJdgmnClCdYn") === 'Y') {
                          show("bidInst");
                          show("bidInst1");
                      }
                      if (qltyMgcsAprtTrgtYn === "Y" || qualityMacostATrgetBidYn === "Y" || (qualityMacostATrgetBidYn === "N" && qualityMacostInputSpuseComptYn === "Y")) {
                          show("qltyMgcsAprtTrgtTxt");
                          aCnt++;
                      }
                      show("bidInstA");
                  }
                  show("natAnnuityIns");              //국민연금보험료
                  show("natHealthIns");               //국민건강보험료
                  show("retireDeductPremium");        //퇴직공제부금비
                  show("silverLongCareIns");          //노인장기요양보험료
                  show("safertyMacost");              //산업안전보건관리비

                  if (qltyMgcsAprtTrgtYn === "Y" || (qualityMacostATrgetBidYn === "Y" && qualityMacostInputSpuseComptYn === "Y")) {
                      show("sftyChckMgcsT");         //안전관리비 보임
                      show("qltyMgcsT");             //품질관리비 보임
                  }else if (qualityMacostATrgetBidYn === "Y" && qualityMacostInputSpuseComptYn === "N") {
                      show("sftyChckMgcsTqltyMgcsT"); //안전관리비+품질관리비
                  }else{
                      show("sftyChckMgcsT");         //안전관리비 보임
                  }
                  if(smkpSumAmtTrgetYn === "Y"){
                      show("smkpSumAmtT");         //표준시장단가 보임
                      show("bidInst1a");
                      aCnt++;
                  }
                  // [건설산업기본법(비대상)기준 적용] 품질관리비, 안전관리비 항목 삭제 (단, 국가유산수리 공사 '대상' 공고는 적용대상에서 제외)
                  if (dlBsisAinfoM.get("prcmMthoSeCd") === '조020001' && faciNtrgtCrtrAplcnYn === 'Y' && faciAplcnYn === 'N' && cltptyCstrnLmtYn === 'N') {
                      if(isShown("sftyChckMgcsT")){
                          hide("sftyChckMgcsT");// 안전관리비
                          aCnt--;
                      }
                      if(isShown("qltyMgcsT")){
                          hide("qltyMgcsT");    // 품질관리비
                          aCnt--;
                      }
                  }
              }
              setText("aCntTxt", "아래 "+ aCnt +"개 항목의 합산 금액(A)은 입찰가격 평가 시 제외합니다.");
              if (!isEmpty(odn1AddMatr)) {
                  show("add3");    //추가사항 1
              }
              if (!isEmpty(odn2AddMatr)) {
                  show("add4");    //추가사항 2
              }

          }
      }
  } else if (prcmBsneSeCd === "05" || (prcmBsneSeCd === "03" && srvcePrdctCmplsYn !== "Y") ){
      hide("tag1");        //공사기초금액 정보 숨김

      show("prcmBsneSe5");
      show("prcmBsneSe6");
      const bsamt = String(dlBsisAmtRM.get("bsamt") ?? "").replace(/,/gi, "");  // 예비가격 기초금액
      const kornBsamt = formatAmount(dlBsisAmtRM.get("bsamt")) + "   ( " + formatKoreanAmount(bsamt) + " )";
      dlBsisAmtRM.set("bsamt", kornBsamt);

      const prceCrtRangRt = dlBsisAmtRM.get("prceCrtRangRt");
      const rsvePrceRangSeCd = dlBsisAmtRM.get("rsvePrceRangSeCd");
      if ((dlBsisAmtRM.get("isFixDateOver") === true && (prcmBsneSeCd === "03" && srvcePrdctCmplsYn !== "Y")) || (dlBsisAmtRM.get("isDualStdStartDtOver") === true && prcmBsneSeCd === '05')) {

          dlBsisAmtM.set("sign3", reservePriceText(rsvePrceRangSeCd, prceCrtRangRt));
      }else{
          hide("sign03");
      }
  }

  return { visibility, text, standardFilename };
}

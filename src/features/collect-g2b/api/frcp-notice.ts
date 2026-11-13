import type { NoticeKey } from "@/entities/notice";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { postG2b } from "./request";

// 업무진행 응답이 22를 반환한 공고는 전용 상세 데이터 맵을 사용한다.
export const frcpNoticeBusinessCode = "22";

// 나라장터 화면에서 상세 조회 시 보내는 초기 데이터 맵의 빈 필드다.
const emptyFields = {
  prcmMthoSeCd: "",
  pbancSttsNm: "",
  bidPbancPgstCd: "",
  pbancKndNm: "",
  emrgPbancYn: "",
  lastPbancYn: "",
  pbancPstgDt: "",
  bidPbancNoOrd: "",
  ctrtDmndRcptNo: "",
  ctrtDmndRcptNoOrd: "",
  bidPbancNm: "",
  pbancInstUntyGrpNm: "",
  dmstUntyGrpNm: "",
  specRlsDt: "",
  bfSpecRegNo: "",
  bidMthdCd: "",
  bidMthdNm: "",
  lcrtTyCd: "",
  scsbdMthdNm: "",
  scsbdMthdDtlsCrtrNo: "",
  stdCtrtMthdCd: "",
  stdCtrtMthdNm: "",
  oderPlanUntyNo: "",
  bidDepoPayTermDt: "",
  athmDocSbmsnDdlnDt: "",
  dmstcOvrsSeNm: "",
  usrDocNoVal: "",
  frstAtmgNm: "",
  bidBlffNm: "",
  pbancPicNm: "",
  pbancPicDeptNm: "",
  pbancPicTlphNo: "",
  slprRcptBgngDt: "",
  slprRcptDdlnDt: "",
  onbsPrnmntDt: "",
  onbsPlacNm: "",
  rbidPrmsYn: "",
  bidQlfcRegDt: "",
  rschDvlpItemYn: "",
  itemPbancUntyAtchFileNo: "",
  bidDepoPayYn: "",
  rfpNo: "",
  rfpOrd: "",
  relaPbancList: "",
  ctrtTyCdNm: "",
  pbancNdcsYn: "",
  evlMaagSeCd: "",
  evlMaagSeNm: "",
  evlSysUtztnYn: "",
  evlSysUtztnYnNm: "",
  evlDocSbmsnElctHdwrSeCd: "",
  evlDocSbmsnElctHdwrSeNm: "",
  evlDocSbmsnBgngDt: "",
  evlDocSbmsnDdlnDt: "",
  evlPrgrsOnofSeCd: "",
  evlPrgrsOnofSeNm: "",
  techAbltEvlRt: "",
  bidPrceEvlRt: "",
  stbltCrtrScr: "",
  rfpSbmsnDocTyNm: "",
  evlPlacNm: "",
  evlTyEachCnt01: "",
  scsbdMthdDtlsNm: "",
  blndEvlAplcnYn: "",
  blndEvlAplcnNm: "",
};

/**
 * 업무구분 22의 상세 API를 익명 세션으로 조회한다.
 * @param key 상세 조회에 사용할 공고번호와 차수.
 * @param methodCode 목록에서 받은 낙찰방법 코드. 값이 없으면 빈 문자열을 전달한다.
 * @throws 익명 세션 발급 실패, 점검 또는 상세 조회 오류를 전달한다.
 */
export async function fetchFrcpNotice(key: NoticeKey, methodCode: string) {
  const request = await createG2bSession();
  return postG2b(
    "/pn/pnp/pnpe/BidPbac/selectFrcpBidPbacDtlInfo.do",
    "FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_sbmBidPbacRqdc",
    { dlBidPbancM: { ...emptyFields, bidPbancNo: key.number, bidPbancOrd: key.revision,
      prcmBsneSeCd: frcpNoticeBusinessCode, scsbdMthdCd: methodCode } },
    request,
  );
}

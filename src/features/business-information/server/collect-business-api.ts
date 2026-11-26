import { BUSINESS_APIS, type BusinessApi, type BusinessItem } from "@/entities/business/model/business-apis";
import { collectionAsyncStep, collectionError, collectionStep } from "@/shared/api/g2b/collection-diagnostic";
import { readBusinessXml, xmlChild } from "./business-xml";

/** 조달청 서비스의 공용 HTTPS 기본 주소. */
const PPS_URL = "https://apis.data.go.kr/1230000/ao/UsrInfoService02";
/** SMPP 서비스의 공용 HTTPS 기본 주소. */
const SMPP_URL = "https://apis.data.go.kr/B550598/smppCertInfo";
/** 한 번의 요청에 요청할 최대 업무 행 수. */
const PAGE_SIZE = 100;
/** 동일 API의 전체 페이지 수집에 적용하는 제한 시간. */
export const BUSINESS_API_TIMEOUT_MS = 25_000;

/**
 * 응답에서 객체로 선언된 단위만 읽는다.
 * @param value JSON 또는 XML 변환에서 추출한 임의의 값.
 * @returns 배열이 아닌 객체 또는 undefined.
 */
function record(value: unknown): Record<string, unknown> | undefined {
  // 배열과 null을 응답 객체로 취급하면 오류가 빈 데이터로 처리될 수 있다.
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * 제공기관별 응답을 결과 코드, 페이지 정보, 업무 행으로 읽는다.
 * @param body 해석할 응답 원문.
 * @param isXml SMPP 업무 응답 여부. 조달청 게이트웨이 XML 오류는 본문으로 감지한다.
 * @returns 검증 전 업무 응답과 페이지 메타데이터.
 * @throws JSON 또는 XML 본문이 잘못된 경우.
 */
function readEnvelope(body: string, isXml: boolean) {
  // 조달청도 공통 인증 오류를 XML로 반환할 수 있다.
  if (isXml || body.trimStart().startsWith("<")) {
    // XML 공통 오류의 코드와 메시지는 업무 응답 구조와 별도로 읽는다.
    const document = readBusinessXml(body);
    const gateway = xmlChild(xmlChild(document, "OpenAPI_ServiceResponse"), "cmmMsgHeader");
    if (gateway) {
      // 인증·쿼터 오류는 정상 빈 업무 응답으로 저장되지 않도록 결과 코드로 전달한다.
      return {
        code: xmlChild(gateway, "returnReasonCode")?.text,
        message: xmlChild(gateway, "returnAuthMsg")?.text,
        items: undefined, page: undefined, size: undefined, total: undefined,
      };
    }
    // SMPP의 페이지 정보는 직속 요소에서 읽고 업무 행은 body 안에서 읽는다.
    const root = xmlChild(document, "response");
    const header = xmlChild(root, "HeaderValueList");
    const items = xmlChild(xmlChild(root, "body"), "items");
    // 업무 필드는 태그 텍스트 그대로 옮겨 빈 요소와 누락 요소를 구분한다.
    return {
      code: xmlChild(header, "resultCode")?.text.trim(),
      message: xmlChild(header, "resultMsg")?.text,
      items: items?.children.filter(({ name }) => name === "item").map(({ element }) =>
        Object.fromEntries(element.children.map(({ name, element: field }) => [name, field.text]))),
      page: xmlChild(root, "pageNo")?.text,
      size: xmlChild(root, "numOfRows")?.text,
      total: xmlChild(root, "totalCount")?.text,
    };
  }

  // 조달청 JSON은 header와 body를 구분해 공통 정보가 업무 행에 섞이지 않게 한다.
  const document = record(JSON.parse(body));
  const root = record(document?.response);
  // 조달청의 HTTP 200 업무 오류는 정상 응답과 다른 이름의 봉투로 반환된다.
  const header = record(root?.header) ?? record(record(document?.["nkoneps.com.response.ResponseError"])?.header);
  const data = record(root?.body);
  // 검증 단계에서 코드·페이지 정보·행을 각각 확인한다.
  return {
    code: header?.resultCode, message: header?.resultMsg, items: data?.items,
    page: data?.pageNo, size: data?.numOfRows, total: data?.totalCount,
  };
}

/**
 * 페이지 메타데이터를 업무 값의 원본 형식과 분리해 비교용 정수로 바꾼다.
 * @param value 외부 응답의 숫자 또는 XML 숫자 문자열.
 * @returns 유효한 음이 아닌 정수 또는 NaN.
 */
function pageNumber(value: unknown) {
  // 빈 문자열·null을 0으로 변환하면 오류 응답을 빈 성공으로 오인할 수 있다.
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  // 비정상 페이지 범위와 표현할 수 없는 수를 거절한다.
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : NaN;
}

/**
 * 업무 행을 검증하고 문서에 있는 필드를 고정 순서로 보존한다.
 * @param value 외부 API의 단일 업무 행.
 * @param kind 요청한 업무 유형.
 * @param number 요청한 사업자등록번호.
 * @returns 업무 항목의 원래 필드 값.
 * @throws 행의 대상이나 필드 형태가 요청과 맞지 않는 경우.
 */
function readItem(value: unknown, kind: BusinessApi, number: string): BusinessItem {
  // 조달청은 사업자번호, SMPP는 응답에 포함된 확인서 유형으로 대상을 검증한다.
  const item = record(value);
  const { certificate, fields } = BUSINESS_APIS[kind];
  if (!item || (certificate ? item.certSeCode !== certificate : item.bizno !== number)) {
    // 다른 업체 또는 다른 증명 유형이 공유 사업자에 저장되는 것을 막는다.
    throw new Error("사업자 정보 응답의 조회 대상이 일치하지 않습니다.");
  }

  // 문서에서 정의한 이름으로만 JSON을 구성해 항목의 동일성 비교를 안정화한다.
  const data: BusinessItem = {};
  for (const field of fields) {
    // 누락은 키를 생성하지 않고 별도로 반환된 null·빈값은 그대로 유지한다.
    if (!Object.hasOwn(item, field)) continue;
    const original = item[field];
    if (original !== null && typeof original !== "string" && typeof original !== "number" && typeof original !== "boolean") {
      // 문서 계약을 벗어난 업무 필드는 실패로 처리해 기존 결과를 보존한다.
      throw new Error("사업자 정보 응답에 지원하지 않는 업무 필드 값이 있습니다.");
    }
    // 표시를 위한 변환 없이 원본 스칼라를 저장용 행에 넣는다.
    data[field] = original as BusinessItem[string];
  }
  // 문서상의 업무 필드만 반환한다.
  return data;
}

/**
 * 사업자 정보 API 한 종류의 모든 페이지를 읽고 행을 검증한다.
 * @param kind 호출할 업무 API 식별자.
 * @param number 검증된 10자리 사업자등록번호.
 * @param referenceDate SMPP의 전체 페이지에 동일하게 적용할 한국 기준일.
 * @returns 검증된 전체 업무 행. 정상 빈 응답은 빈 배열이다.
 * @throws 키 설정, HTTP, 제공기관 결과 코드, 구문 또는 응답 검증에 실패한 경우.
 */
export async function collectBusinessApi(kind: BusinessApi, number: string, referenceDate: string): Promise<BusinessItem[]> {
  // 고정된 API 정의와 서버 환경에서만 주소와 인증 키를 선택한다.
  const { operation, certificate } = BUSINESS_APIS[kind];
  const key = (certificate ? process.env.SMPP_CERT_INFO_SERVICE_KEY : process.env.PPS_USER_INFO_SERVICE_KEY)?.trim();
  if (!key) {
    // 어떤 서버 설정을 확인할지 드러내면서 키 값의 노출은 피한다.
    throw collectionError(new Error("사업자 정보 API 서비스 키가 설정되지 않았습니다."), { step: "수집 설정", details: { operation } });
  }

  // 업무별 HTTPS 주소와 서비스가 요구하는 사업자번호·검색 구분을 적용한다.
  const url = new URL(`${certificate ? SMPP_URL : PPS_URL}/${operation}`);
  const query = url.searchParams;
  if (certificate) {
    // SMPP는 기준일 시점의 유효 인증서를 사업자번호로 조회한다.
    query.set("bsnmNo", number);
    query.set("stdrDate", referenceDate);
  } else {
    // 조달청 기본정보는 구분 3, 나머지 API는 구분 1에서 사업자번호만으로 조회한다.
    query.set("bizno", number);
    query.set("inqryDiv", kind === "basic" ? "3" : "1");
    query.set("type", "json");
  }
  // 포털에서 복사한 인코딩 키도 URL 작성 과정에서 한 번만 인코딩한다.
  const decodedKey = collectionStep("수집 설정", () => decodeURIComponent(key));
  query.set(certificate || kind === "sanction" ? "ServiceKey" : "serviceKey", decodedKey);
  query.set("numOfRows", String(PAGE_SIZE));

  // 모든 페이지에 하나의 마감 시각을 적용하여 실행권 만료 전에 외부 호출을 중단한다.
  const signal = AbortSignal.timeout(BUSINESS_API_TIMEOUT_MS);
  const request = { path: url.pathname, timeoutMs: BUSINESS_API_TIMEOUT_MS };
  // 전체 응답을 검증할 때까지 DB 반영 없이 행과 첫 페이지의 전체 건수를 보관한다.
  const items: BusinessItem[] = [];
  let expectedTotal: number | undefined;
  let expectedSize: number | undefined;
  for (let page = 1; ; page++) {
    // 응답의 현재 페이지를 확인할 수 있게 요청에 페이지 순번을 지정한다.
    query.set("pageNo", String(page));
    let response: Response | undefined;
    let step = "외부 API 요청";
    let errorCode: string | number | undefined;
    let errorMessage: string | undefined;
    try {
      // 고정 호스트로 요청하고 인증 키가 다른 위치로 전달될 리디렉션은 허용하지 않는다.
      response = await collectionAsyncStep(step, () => fetch(url, { cache: "no-store", redirect: "error", signal }));
      // HTTP 오류나 해석 오류에는 경로와 상태를 부여하고 응답 본문은 진단으로 전달하지 않는다.
      step = "응답 확인";
      if (!response.ok) throw new Error("사업자 정보 API의 HTTP 요청이 실패했습니다.");
      const body = await response.text();
      // 응답 구문 실패가 HTTP 또는 업무 코드 실패와 구분되게 한다.
      step = "응답 해석";
      const data = collectionStep(step, () => readEnvelope(body, Boolean(certificate)));
      // 업무 결과 오류의 코드는 공통 진단에 보관하고 성공 응답만 행으로 처리한다.
      step = "업무 결과 확인";
      errorCode = typeof data.code === "string" || typeof data.code === "number" ? data.code : undefined;
      errorMessage = typeof data.message === "string" ? data.message : undefined;
      // SMPP 3종은 매칭 데이터가 없으면 본문 대신 이 결과 코드와 문구를 보낸다.
      if (certificate && page === 1 && data.code === "90" &&
          errorMessage?.trim() === "매칭데이터가 존재하지 않습니다." && data.items === undefined) return [];
      if (data.code !== "00" && data.code !== 0) throw new Error("사업자 정보 API가 업무 오류를 반환했습니다.");

      // 페이지 반복, 누락, 건수 변동이 있으면 불완전한 응답을 저장하지 않는다.
      step = "응답 검증";
      const total = pageNumber(data.total);
      const size = pageNumber(data.size);
      expectedTotal ??= total;
      expectedSize ??= size;
      const rows = total === 0 && data.items == null ? [] : data.items;
      if (pageNumber(data.page) !== page || total !== expectedTotal || size !== expectedSize || size <= 0 ||
          !Array.isArray(rows) || rows.length !== Math.min(size, total - items.length)) {
        throw new Error("사업자 정보 응답의 페이지 또는 행 수가 일치하지 않습니다.");
      }

      // 수집 문서의 업무 필드만 검증한 뒤 현재 시도의 결과에 추가한다.
      for (const row of rows) {
        items.push(readItem(row, kind, number));
      }
      // 정상 빈 결과도 총 건수에 도달한 성공으로 반환한다.
      if (items.length === expectedTotal) return items;
    } catch (error) {
      // 경로·페이지·제공기관 결과와 원래 예외를 공통 수집 진단에 연결한다.
      throw collectionError(error, {
        step, request, details: { operation, page },
        response: response ? { status: response.status, errorCode, errorMessage } : undefined,
      });
    }
  }
}

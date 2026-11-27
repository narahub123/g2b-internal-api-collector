/**
 * 보고서 요청 한 단계의 고정 설정이다.
 */
type IndustryLawRequest = {
  /** 포털에 보낼 HTTP 메서드. */
  method: string;
  /** 실행 상태의 자리표시자를 포함할 수 있는 요청 URL. */
  url: string;
  /** 요청을 구성할 헤더 이름과 값. */
  headers: Record<string, string>;
  /** JSON 본문 또는 중복 이름의 순서를 유지하는 폼 항목. */
  body?: string | [string, string][];
};

// 업종 보고서의 각 단계에서 사용하는 고정 요청 형식이다.
// 중괄호로 표시한 값은 현재 실행의 응답 또는 실행 시각으로 채운다.
export const industryLawRequests: Record<number, IndustryLawRequest> = {
  // 공개 리포트의 게스트 세션을 설정한다.
  1: {
    // 이 단계의 요청 방식과 목적지를 지정한다.
    method: "POST",
    url: "https://data.g2b.go.kr/portal/plugins/esm/jsp/sso.jsp?mstrUserId=guest02",
    // 포털이 기대하는 응답 형식과 출처 정보를 전달한다.
    headers: {
      "Accept": "*/*",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Content-Type": "application/json;charset=utf-8",
      "Origin": "https://data.g2b.go.kr",
      "Referer": "https://data.g2b.go.kr/index.do?w2xPath=/kn/layout/nara/popupLayout.xml&w2xHome=/kn/layout/nara/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
    },
  },
  // 빈 검색조건에 해당하는 프롬프트 XML을 요청한다.
  2: {
    // 이 단계의 요청 방식과 목적지를 지정한다.
    method: "POST",
    url: "https://data.g2b.go.kr/portal/app/getAnswerXML.json",
    // 포털이 기대하는 응답 형식과 출처 정보를 전달한다.
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Content-Type": "application/json;charset=UTF-8",
      "Origin": "https://data.g2b.go.kr",
      "Referer": "https://data.g2b.go.kr/index.do?w2xPath=/kn/layout/nara/popupLayout.xml&w2xHome=/kn/layout/nara/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
    },
    // 전체 업종을 대상으로 하므로 검색 필터는 비워 둔다.
    body: "{\"objectId\":\"0E16C98C4E2A9C6FD83EAA971737042E\",\"type\":3,\"promptVal\":{}}",
  },
  // 검색조건 XML로 전체 업종 리포트를 실행한다.
  3: {
    // 이 단계의 요청 방식과 목적지를 지정한다.
    method: "POST",
    url: "https://data.g2b.go.kr/portal/servlet/mstrWeb",
    // 포털이 기대하는 응답 형식과 출처 정보를 전달한다.
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://data.g2b.go.kr",
      "Referer": "https://data.g2b.go.kr/index.do?w2xPath=/kn/layout/nara/popupLayout.xml&w2xHome=/kn/layout/nara/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
    },
    // 같은 이름의 필드도 수신 서버에서 처리하는 순서대로 전송한다.
    body: [
      ["server","ANOLAP"],
      ["port","24952"],
      ["project","DATAHUB"],
      ["hiddenSections","path,header,footer,dockLeft,dockTop"],
      ["promptAnswerMode","2"],
      ["reportID","0E16C98C4E2A9C6FD83EAA971737042E"],
      ["evt","4001"],
      ["src","mstrWeb.4001"],
      ["promptsAnswerXML","{{prompt_xml}}"],
    ],
  },
  // 전체 CSV 출력 옵션을 전달하고 다운로드 폼을 받는다.
  4: {
    // 이 단계의 요청 방식과 목적지를 지정한다.
    method: "POST",
    url: "https://data.g2b.go.kr/portal/servlet/mstrWeb?name={{export_name}}",
    // 포털이 기대하는 응답 형식과 출처 정보를 전달한다.
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://data.g2b.go.kr",
      "Referer": "https://data.g2b.go.kr/portal/servlet/mstrWeb",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
    },
    // 같은 이름의 필드도 수신 서버에서 처리하는 순서대로 전송한다.
    body: [
      ["exportSection","1"],
      ["exportFormatGrids","csvIServer"],
      ["exportPlaintextDelimiter","1"],
      ["exportReportTitle","1"],
      ["exportReportTitle","0"],
      ["exportFilterDetails","1"],
      ["exportFilterDetails","0"],
      ["exportOverlapGridTitles","3"],
      ["hiddenSections","path,header,footer,dockLeft,dockTop"],
      ["evt","25002"],
      ["src","mstrWeb.exportOptionsFromReport.options.25002"],
      ["keepPreferences","0"],
      ["prevGroupName","export"],
      ["target","excelHeaderFooter"],
      ["exportMetricValuesAsText","1"],
      ["exportMetricValuesAsText","0"],
      ["exportHeadersAsText","1"],
      ["exportHeadersAsText","0"],
      ["hiddenSections","path,header,footer,dockLeft,dockTop"],
      ["evt","3131"],
      ["src","mstrWeb.3131"],
      ["eventToForwardTo","3012"],
      ["actionType","3"],
      ["updateParentWindow","true"],
      ["PDFOutlineModeState",""],
      ["hiddenSections","path,header,footer,dockLeft,dockTop"],
      ["evt","25003"],
      ["src","mstrWeb.exportOptionsFromReport.options.25003"],
      ["level","user_project"],
      ["mstrWeb","{{report_mstrWeb}}"],
      ["exportOptionsFromReport","*-1.*-1.0.0.0"],
      ["options","*-1.*-1.0.0.user.export...1..0.*0.*0.*0.*0.*0.*0.0.0.0."],
      ["rb","{{report_rb}}"],
      ["directExport","*-1.*-1.0.0.0.1"],
      ["3131","내보내기"],
    ],
  },
  // 준비 응답의 폼 상태로 전체 CSV를 받는다.
  5: {
    // 이 단계의 요청 방식과 목적지를 지정한다.
    method: "POST",
    url: "https://data.g2b.go.kr/portal/export/UI-ADOBAA-001R_%EC%97%85%EC%A2%85_%EB%B0%8F_%EA%B7%BC%EA%B1%B0%EB%B2%95%EA%B7%9C_%EB%82%B4%EC%97%AD.csv",
    // 포털이 기대하는 응답 형식과 출처 정보를 전달한다.
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://data.g2b.go.kr",
      "Referer": "https://data.g2b.go.kr/portal/servlet/mstrWeb?name={{export_name}}",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
    },
    // 같은 이름의 필드도 수신 서버에서 처리하는 순서대로 전송한다.
    body: [
      ["hiddenSections","path,header,footer,dockLeft,dockTop"],
      ["evt","3012"],
      ["src","mstrWeb.3012"],
      ["PDFOutlineModeState",""],
      ["exportSection","1"],
      ["exportFormatGrids","csvIServer"],
      ["exportPlaintextDelimiter","1"],
      ["exportMetricValuesAsText","1"],
      ["exportHeadersAsText","1"],
      ["exportFilterDetails","1"],
      ["exportOverlapGridTitles","3"],
      ["mstrWeb","{{export_mstrWeb}}"],
      ["SaveReportProperties","*-1.*-1.0.0.0"],
      ["rb","{{export_rb}}"],
    ],
  },
};

// 실행마다 발급된 쿠키를 출처와 경로에 맞춰 관리한다.
import { CookieJar } from 'tough-cookie';
// 폼 속성에서 HTML 이스케이프를 한 번 해제한다.
import { decodeHTMLAttribute } from 'entities';
// HTTP 요청의 고정 형식과 순서를 가져온다.
import { industryLawRequests } from './industry-law-requests';

// 저장본과 응답에서 확인할 공개 보고서 식별자다.
export const reportId = 'UI-ADOBAA-001R';
// 정상 포털 리다이렉트가 이동할 수 있는 출처다.
const origins = new Set(['https://data.g2b.go.kr', 'https://sso.g2b.go.kr']);
// 요청 방식의 전환 규칙을 적용할 리다이렉트 상태다.
const redirects = new Set([301, 302, 303, 307, 308]);
// 내보내기 헤더의 표시 순서와 이름이 생략되는 열을 정의한다.
const csvHeader = ['업종분류', '', '업종', '', '근거법령', '관련규정내용', '사용여부', '제한업종', '', '허용업종', ''];
// CSV 위치별로 JSON에 저장할 필드를 정의한다.
const columns = ['categoryCode', 'categoryName', 'industryCode', 'industryName', 'legalBasis', 'relatedRules', 'active', 'restrictedCode', 'restrictedName', 'allowedCode', 'allowedName'] as const;
// 진단 출력에서 요청 단계의 이름을 식별한다.
const stages = { 1: 'SSO', 2: '검색조건 XML', 3: '보고서 조회', 4: 'CSV 내보내기 준비', 5: 'CSV 다운로드' };

/**
 * CSV의 11개 항목을 문자열 그대로 보존하는 한 행이다.
 */
export type IndustryLawRow = Record<(typeof columns)[number], string>;

/**
 * 저장된 업종 행이 변환 결과와 같은 문자열 필드를 가지는지 확인한다.
 * @param value 저장 목록에서 읽은 행.
 * @returns 업종코드와 전체 필드가 유효한지 여부.
 */
export function isIndustryLawRow(value: unknown): value is IndustryLawRow {
  // 열 목록을 변환기와 공유해 저장본 검증 기준을 일치시킨다.
  const row = value as Partial<IndustryLawRow> | null;
  if (typeof row?.industryCode !== 'string' || !row.industryCode.trim()) return false;
  for (const column of columns) {
    if (typeof row[column] !== 'string') return false;
  }
  return true;
}

/**
 * MicroStrategy 폼이 후속 요청에 전달하는 상태다.
 */
type FormState = {
  /** 현재 폼에 적용된 리포트 세션 상태. */
  mstrWeb: string;
  /** 현재 폼의 리포트 실행 상태. */
  rb: string;
};

/**
 * 조회에서 확인한 데이터 버전과 내보내기 상태다.
 */
type ReportState = FormState & {
  /** 리포트가 표시하는 최근 수정 문자열. */
  lastUpdate: string;
  /** 리포트가 보고한 전체 데이터 행 수. */
  totalRows: number;
};

/**
 * 검증을 마친 CSV의 변환 결과다.
 */
type DownloadResult = {
  /** 변환 중 확인한 고유 업종코드 수. */
  codes: number;
  /** 인코딩된 CSV의 응답 바이트 수. */
  bytes: number;
  /** 원본 순서와 반복을 유지하는 행 목록. */
  rows: IndustryLawRow[];
};

/**
 * 수집 실행의 비교 기준과 외부 입출력 설정이다.
 */
type CollectionOptions = {
  /** 기존 JSON에 적용된 수정 문자열. */
  appliedLastUpdate?: string;
  /** 테스트에서 실제 네트워크를 대신할 요청 함수. */
  fetchImpl?: typeof fetch;
  /** 민감한 상태를 제외한 단계 결과를 전달할 함수. */
  onStep?: (event: {
    /** Postman 컬렉션에 대응하는 요청 번호. */
    step: number;
    /** 진단에 표시할 요청 단계 이름. */
    name: string;
    /** 응답이 있으면 그 HTTP 상태. */
    status?: number;
    /** 검증 결과 또는 생략 사유. */
    result: string;
    /** 요청과 응답 검증에 걸린 밀리초. */
    ms?: number;
  }) => void;
};

/**
 * 변경 여부와 함께 CLI가 저장과 보고에 사용할 데이터다.
 */
type CollectionResult = Partial<DownloadResult> & Pick<ReportState, 'lastUpdate' | 'totalRows'> & {
  /** 다운로드한 바이트 수이며 생략한 경우 0이다. */
  bytes: number;
};

/**
 * 단계에서 검증한 결과와 진단용 상태다.
 */
type StepResult<T> = {
  /** 다음 단계에 전달할 검증 값. */
  value?: T;
  /** 기본 성공 문구를 대신할 단계 표시. */
  result?: string;
};

/**
 * 리포트 폼에서 현재 실행의 상태를 찾아 속성 이스케이프를 해제한다.
 * @param {string} html 포털이 반환한 리포트 또는 내보내기 HTML.
 * @param {string} name 필요한 상태가 들어 있는 폼 이름.
 * @returns {{mstrWeb:string, rb:string}} 다음 요청에 전달할 두 상태값.
 * @throws 폼이나 상태값이 누락되었을 때 응답 검증 오류.
 */
function readFormState(html: string, name: string): FormState {
  // 폼 밖의 같은 이름을 가진 입력을 사용하지 않도록 범위를 제한한다.
  const form = html.match(new RegExp('<form\\b[^>]*\\s(?:id|name)=["\']' + name + '["\'][^>]*>[\\s\\S]*?<\\/form>', 'i'));
  // 상태를 담을 대상 폼이 있는지 검사한다.
  if (!form) throw new Error(name + ' 폼 누락');
  // 두 상태값을 모아 다음 요청 형식에 전달한다.
  const state: FormState = { mstrWeb: '', rb: '' };
  for (const field of ['mstrWeb', 'rb'] as const) {
    // 속성 순서와 관계없이 필요한 입력의 값을 찾는다.
    const input = form[0].match(new RegExp('<input\\b[^>]*\\sname=["\']' + field + '["\'][^>]*>', 'i'));
    const value = input?.[0].match(/\svalue=(["'])([\s\S]*?)\1/i)?.[2];
    if (!value) throw new Error(name + ' 필수 상태 누락: ' + field);
    // URL 폼 인코딩 전에 HTML 속성 이스케이프만 제거한다.
    state[field] = decodeHTMLAttribute(value);
  }
  // 모두 확인한 상태를 반환한다.
  return state;
}

/**
 * CSV 제목과 데이터 구분자를 찾고 전체 행을 순서대로 변환한다.
 * @param {ArrayBuffer} bytes 서버가 반환한 UTF-16LE 바이트열.
 * @param {number} totalRows 보고서에서 확인한 전체 행 수.
 * @returns 원본 순서와 반복을 유지한 행 및 고유 업종코드 수.
 * @throws 디코딩, 헤더, 필드 구문 또는 행 수가 예상 형식과 다를 때.
 */
function parseCsv(bytes: ArrayBuffer, totalRows: number): Omit<DownloadResult, 'bytes'> {
  // 손상된 바이트가 조용히 대체 문자로 변경되지 않도록 검사한다.
  const csv = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  // 안내문 뒤에 나오는 헤더에서 콤마 또는 탭을 식별한다.
  const header = /^"?업종분류"?([,\t])/m.exec(csv);
  if (!header) throw new Error('CSV 헤더 누락');
  const delimiter = header[1];
  // 따옴표 안의 줄바꿈과 구분자 및 이중 따옴표를 한 필드로 읽는다.
  const field = new RegExp('(?:"((?:[^"]|"")*)"|([^"\\r\\n' + delimiter + ']*))(' + delimiter + '|\\r\\n|\\n|\\r|$)', 'gy');
  field.lastIndex = header.index;
  // 첫 레코드는 헤더로 검증하고 이후 레코드는 JSON 행으로 변환한다.
  let headerRead = false;
  let values: string[] = [];
  const rows: IndustryLawRow[] = [];
  // 원본 행은 그대로 두고 표시용으로만 고유 코드를 센다.
  const codes = new Set<string>();
  while (field.lastIndex < csv.length || values.length > 0) {
    // 현재 레코드에 연속되는 필드가 없으면 파일이 잘린 것으로 판단한다.
    const match = field.exec(csv);
    if (!match) throw new Error('CSV 필드 형식 오류');
    values.push(match[1]?.replaceAll('""', '"') ?? match[2]);
    if (match[3] === delimiter) continue;
    // 단독 빈 줄은 건너뛰고 원본 레코드의 빈 열은 보존한다.
    if (values.length === 1 && values[0] === '') {
      values = [];
      continue;
    }
    if (values.length !== columns.length) throw new Error('CSV 열 수 불일치');
    if (!headerRead) {
      // 위치별로 고정된 업무 의미를 확인한 뒤 데이터 읽기를 시작한다.
      if (!csvHeader.every(matchesHeader)) throw new Error('CSV 헤더 불일치');
      headerRead = true;
    } else {
      // 업종코드를 문자열로 유지하고 같은 코드의 여러 행도 추가한다.
      const entries = columns.map((column, index) => [column, values[index]]);
      const row = Object.fromEntries(entries) as IndustryLawRow;
      rows.push(row);
      codes.add(row.industryCode);
    }
    // 다음 레코드의 열을 모을 초기 상태로 돌아간다.
    values = [];
  }
  // 일부 행만 반환되면 현재 저장본을 교체할 수 없다.
  if (rows.length !== totalRows) throw new Error('CSV 행 수 불일치: ' + rows.length + ' / ' + totalRows);
  return { rows, codes: codes.size };

  /**
   * 현재 헤더 열의 표시 이름을 확인한다.
   * @param {string} label 기대하는 표시 이름.
   * @param {number} index 헤더에서의 위치.
   * @returns {boolean} 공백을 제외한 표시 이름의 일치 여부.
   */
  function matchesHeader(label: string, index: number) {
    return values[index].trim() === label;
  }
}

/**
 * 빈 쿠키 저장소에서 리포트를 실행하고 버전이 바뀐 경우에만 CSV를 변환한다.
 * @param {object} options 요청과 진행 기록에 사용할 설정.
 * @param {string} [options.appliedLastUpdate] 현재 저장본에 적용된 버전.
 * @param {typeof fetch} [options.fetchImpl] HTTP 요청 함수.
 * @param {Function} [options.onStep] 비밀값을 제외한 단계별 결과를 전달할 함수.
 * @returns {Promise<object>} 버전, 요청 통계 및 변경 시 저장할 데이터.
 * @throws 요청 실패, 예상과 다른 응답 또는 CSV 변환 실패.
 */
export async function collectIndustryLaw({ appliedLastUpdate, fetchImpl = fetch, onStep }: CollectionOptions = {}): Promise<CollectionResult> {
  // 실행 간에 포털 세션이 섞이지 않도록 빈 저장소를 만든다.
  const jar = new CookieJar();
  // 후속 폼을 구성하는 동적 값은 이 실행에서만 사용한다.
  const state: Record<string, string> = {};
  // 공개 링크 진입 없이 게스트 SSO로 시작한다. 빈 응답은 프롬프트 생성에서 후속 동작을 판단한다.
  await step(1, inspectSso);
  state.prompt_xml = await step(2, readPrompt);
  // 조회만 수행해도 현재 버전을 비교할 수 있다.
  const report = await step(3, readReport);
  if (appliedLastUpdate === report.lastUpdate) {
    // 내보내기를 전혀 호출하지 않고 비교 결과만 반환한다.
    onStep?.({ step: 4, name: stages[4], result: '생략' });
    onStep?.({ step: 5, name: stages[5], result: '생략' });
    return { lastUpdate: report.lastUpdate, totalRows: report.totalRows, bytes: 0 };
  }
  // 보고서와 내보내기 준비의 상태를 각각 올바른 요청에 전달한다.
  state.report_mstrWeb = report.mstrWeb;
  state.report_rb = report.rb;
  state.export_name = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
  const exportForm = await step(4, readExport);
  state.export_mstrWeb = exportForm.mstrWeb;
  state.export_rb = exportForm.rb;
  const download = await step(5, readDownload);
  // 완전한 데이터와 그 버전을 함께 반환한다.
  return { lastUpdate: report.lastUpdate, totalRows: report.totalRows, ...download };

  /**
   * 현재 실행에서 얻은 상태로 요청 형식의 자리를 채운다.
   * @param {string} template 경로나 폼 값의 고정 형식.
   * @returns {string} HTTP 요청에 전달할 값.
   * @throws 필수 실행 상태가 누락된 경우.
   */
  function fill(template: string) {
    return template.replace(/\{\{(\w+)\}\}/g, substitute);
  }

  /**
   * 한 자리표시자에 실행 중 확보한 값을 넣는다.
   * @param {string} placeholder 원래 자리표시자.
   * @param {string} key 현재 실행 상태에서 사용할 키.
   * @returns {string} 현재 실행에 해당하는 값.
   * @throws 상태가 확보되지 않은 경우.
   */
  function substitute(_placeholder: string, key: string) {
    if (!Object.hasOwn(state, key)) throw new Error('요청 상태 누락: ' + key);
    return state[key];
  }

  /**
   * 한 단계를 실행하고 응답을 검증한 뒤 소요 시간을 기록한다.
   * @param {number} index 컬렉션 요청 번호.
   * @param {Function} inspect 응답을 읽고 검사하는 함수.
   * @returns {Promise<*>} 검증 함수에서 추출한 데이터.
   * @throws HTTP 또는 응답 실패 지점을 포함한 오류.
   */
  async function step<T>(index: number, inspect: (response: Response) => Promise<StepResult<T>>): Promise<T> {
    // 실패 시에도 성공했던 이전 단계와 실패 HTTP 상태를 함께 확인할 수 있다.
    const started = performance.now();
    let status: number | undefined;
    try {
      // 현재 단계의 URL, 헤더와 폼 본문을 준비한다.
      const template = industryLawRequests[index];
      const headers = new Headers();
      for (const [key, value] of Object.entries(template.headers)) headers.set(key, fill(value));
      // 고정 JSON 본문은 그대로 보내고 폼 항목은 요청 인코딩에 맞춰 변환한다.
      let body: string | URLSearchParams | undefined = typeof template.body === 'string' ? template.body : undefined;
      if (Array.isArray(template.body)) {
        // 같은 이름의 폼 항목을 덮어쓰지 않고 원래 순서대로 보낸다.
        const form = new URLSearchParams();
        for (const [key, value] of template.body) form.append(key, fill(value));
        body = form;
      }
      const response = await request(new URL(fill(template.url)), template.method, headers, body);
      status = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('HTTP 응답 실패');
      }
      const checked = await inspect(response);
      onStep?.({ step: index, name: stages[index], status, result: checked.result ?? '성공', ms: Math.round(performance.now() - started) });
      return checked.value;
    } catch (error) {
      // 원인에 민감한 URL이나 폼 본문이 포함된 경우를 피하고 검증 메시지만 기록한다.
      const reason = status ? error.message : '연결 또는 리다이렉트 실패';
      onStep?.({ step: index, name: stages[index], status, result: '실패', ms: Math.round(performance.now() - started) });
      throw new Error(stages[index] + ': ' + reason);
    }
  }

  /**
   * 허용된 포털 출처 사이에서 HTTP 리다이렉트를 처리하고 쿠키를 갱신한다.
   * @param {URL} url 최초 목적지.
   * @param {string} method 최초 요청 메서드.
   * @param {Headers} headers 이 단계의 요청 헤더.
   * @param {URLSearchParams|string|undefined} body 요청 본문.
   * @returns {Promise<Response>} 최종 응답.
   * @throws 허용되지 않은 이동, 제한 시간 초과 또는 네트워크 오류.
   */
  async function request(url: URL, method: string, headers: Headers, body?: URLSearchParams | string): Promise<Response> {
    // 리다이렉트 및 최종 본문 읽기에 단일 제한 시간을 적용한다.
    const signal = AbortSignal.timeout(30_000);
    for (let hop = 0; hop <= 8; hop++) {
      if (!origins.has(url.origin)) throw new Error('허용하지 않는 포털 출처');
      // 쿠키는 현재 URL에 해당하는 것만 매 요청에 전송한다.
      const cookies = await jar.getCookieString(url);
      if (cookies) headers.set('cookie', cookies);
      else headers.delete('cookie');
      const response = await fetchImpl(url, { method, headers, body, redirect: 'manual', signal });
      for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, url, { ignoreError: true });
      // 리다이렉트가 없는 경우 호출 단계에서 본문을 읽는다.
      const location = response.headers.get('location');
      if (!location || !redirects.has(response.status)) return response;
      await response.body?.cancel();
      const target = new URL(location, url);
      // 브라우저의 일반 폼 리다이렉트와 동일하게 후속 GET을 구성한다.
      if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
      }
      // 다른 출처로 원래 폼 본문을 전달하지 않는다.
      if (target.origin !== url.origin) {
        if (body !== undefined) throw new Error('출처 간 폼 전달 거부');
        headers.delete('origin');
        headers.delete('referer');
        headers.delete('x-requested-with');
      }
      url = target;
    }
    throw new Error('리다이렉트 횟수 초과');
  }

  /**
   * SSO의 빈 응답을 성공으로 단정하지 않고 후속 조회로 이어간다.
   * @param {Response} response 게스트 SSO 응답.
   * @returns {Promise<object>} 본문 유무에 따른 표시 결과.
   */
  async function inspectSso(response: Response): Promise<StepResult<void>> {
    const body = await response.text();
    return { result: body.trim() ? '응답 수신' : '미확정(빈 응답)' };
  }

  /**
   * 성공한 검색조건 응답의 XML만 조회에 넘긴다.
   * @param {Response} response 검색조건 API 응답.
   * @returns {Promise<object>} 이번 실행용 XML.
   * @throws JSON 구문 오류 또는 검색조건 생성 실패.
   */
  async function readPrompt(response: Response): Promise<StepResult<string>> {
    // HTML 안내나 XML 오류 응답이 파서 메시지로 노출되지 않도록 검사한다.
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('검색조건 JSON 응답이 아님');
    let answer;
    try {
      answer = await response.json();
    } catch {
      throw new Error('검색조건 JSON 형식 오류');
    }
    if (answer?.errorCode !== 'success' || typeof answer.xml !== 'string' || !answer.xml.trim()) {
      throw new Error('검색조건 생성 실패');
    }
    return { value: answer.xml };
  }

  /**
   * 조회 HTML에서 버전, 전체 행 수와 내보내기에 쓸 상태를 확보한다.
   * @param {Response} response 보고서 조회 응답.
   * @returns {Promise<object>} 보고서 메타데이터와 실행 상태.
   * @throws 대상 보고서 또는 필수 메타데이터가 없을 경우.
   */
  async function readReport(response: Response): Promise<StepResult<ReportState>> {
    const html = await response.text();
    // 마지막 수정 표시는 공백을 정리한 원본 문자열로 비교한다.
    const lastUpdate = html.match(/['"]lastUpdate['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim();
    const totalRows = Number(html.match(/['"]ifTotalRows['"]\s*:\s*(\d+)/)?.[1]);
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (!title?.includes(reportId) || !lastUpdate || !Number.isSafeInteger(totalRows) || totalRows < 1) {
      throw new Error('보고서 ID, lastUpdate 또는 전체 행 수를 확인할 수 없음');
    }
    return { value: { lastUpdate, totalRows, ...readFormState(html, 'pageStateForm') } };
  }

  /**
   * 내보내기 준비 응답에서 다운로드 폼 상태를 확보한다.
   * @param {Response} response 내보내기 준비 HTML 응답.
   * @returns {Promise<object>} 다운로드 요청에 필요한 상태.
   * @throws 준비 응답에 필요한 폼 상태가 없을 때.
   */
  async function readExport(response: Response): Promise<StepResult<FormState>> {
    return { value: readFormState(await response.text(), 'printForm') };
  }

  /**
   * CSV만 메모리로 받고 보고서 전체와 같은 행 수인지 검증한다.
   * @param {Response} response 전체 CSV 다운로드 응답.
   * @returns {Promise<object>} 응답 크기와 변환 행.
   * @throws 응답이 CSV가 아니거나 변환 검증에 실패할 경우.
   */
  async function readDownload(response: Response): Promise<StepResult<DownloadResult>> {
    if (!response.headers.get('content-type')?.includes('csv')) throw new Error('CSV 응답이 아님');
    const bytes = await response.arrayBuffer();
    return { value: { bytes: bytes.byteLength, ...parseCsv(bytes, report.totalRows) } };
  }
}



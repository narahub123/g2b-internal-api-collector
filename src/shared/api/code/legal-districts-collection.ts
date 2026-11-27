// ZIP을 파일로 추출하지 않고 응답 바이트에서 읽는다.
import Zip from 'adm-zip';

// 조회와 다운로드가 공유하는 행정표준코드관리시스템 출처다.
const origin = 'https://www.code.go.kr';
// 변경기간 조회에 사용하는 주소다.
const searchPath = '/stdcode/regCodeL.do';
// 조회와 다운로드에 공통으로 제출하는 기본 폼이다.
const baseForm = {
  cPage: '1', regionCd_pk: '', chkWantCnt: '0', pageSize: '10', regionCd: '',
  locataddNm: '', sidoCd: '*', sggCd: '*', umdCd: '*', riCd: '*',
};

/** 원본 자료의 한 행이다. */
export type LegalDistrict = {
  /** 앞자리 0을 포함해 보존하는 10자리 코드. */
  code: string;
  /** 자료에서 제공하는 전체 법정동명. */
  name: string;
  /** 현존 및 폐지 구분의 원본 값. */
  status: '존재' | '폐지';
};

/** 원본 조회 또는 다운로드의 진단 정보다. */
type Progress = {
  /** 해당 조회에 사용한 시작일과 종료일. */
  period?: { start: string; end: string };
  /** 요청 조건과 일치하는 응답에서 확인한 변경 건수. */
  count?: number;
  /** 변환을 마친 다운로드의 원본 바이트 수. */
  bytes?: number;
};

/** 전체자료 변환 중에 계산한 행과 상태별 집계다. */
type DistrictDownload = {
  /** 원본 순서를 보존한 행 목록. */
  rows: LegalDistrict[];
  /** 전체 법정동 수. */
  total: number;
  /** 현존 법정동 수. */
  active: number;
  /** 폐지 법정동 수. */
  abolished: number;
};

/**
 * 로컬 실행 시각을 한국 표준시의 날짜로 변환한다.
 * @param now 실행 시작 시각.
 * @returns 연-월-일 문자열.
 */
export function koreanDate(now: Date): string {
  // 한국 표준시 날짜를 ISO 형식으로 맞춘다.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short' }).format(now);
}

/**
 * 저장 날짜나 요청 날짜가 실제 달력 날짜인지 검증한다.
 * @param value 검증할 값.
 * @returns ISO 날짜 형식과 달력 값이 모두 맞는지 여부.
 */
export function isDate(value: unknown): value is string {
  // 날짜가 없거나 2월 30일처럼 자동 보정되는 값을 거부한다.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * 조회 기간을 경계 날짜가 겹치는 최대 1년 구간으로 나눈다.
 * @param start 이전 성공일.
 * @param end 실행 요청일.
 * @yields 순서대로 요청할 시작일과 종료일.
 * @throws 날짜가 잘못되었거나 시작일이 종료일보다 뒤일 때.
 */
function* periods(start: string, end: string) {
  // 조회하지 않은 미래 날짜를 성공일로 반영하지 않도록 검사한다.
  if (!isDate(start) || !isDate(end) || start > end) throw new Error('변경기간 날짜 범위 오류');
  let from = start;
  for (;;) {
    // 윤일의 다음 해는 그 달 마지막 날인 2월 28일로 제한한다.
    const year = Number(from.slice(0, 4)) + 1;
    const anniversary = String(year).padStart(4, '0') + from.slice(4);
    const limit = isDate(anniversary) ? anniversary : String(year).padStart(4, '0') + '-02-28';
    const until = limit < end ? limit : end;
    yield { start: from, end: until };
    // 다음 구간은 이전 종료일을 포함한다.
    if (until === end) return;
    from = until;
  }
}

/**
 * 결과 HTML의 폼 조건과 집계값을 검증한다.
 * @param html 변경 조회 응답 본문.
 * @param start 실제 요청 시작일.
 * @param end 실제 요청 종료일.
 * @returns 정상 결과의 전체 건수.
 * @throws 응답 조건이나 집계값이 없거나 서로 다를 때.
 */
function readCount(html: string, start: string, end: string): number {
  // 속성 순서와 따옴표 형식에 관계없이 입력의 속성을 수집한다.
  const dates = new Map([['stdate', start], ['enddate', end]]);
  // 중복 날짜와 복수 선택을 검증하기 위한 상태다.
  const seen = new Set<string>();
  let selected = false;
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const [, key, double, single, bare] of tag.slice(6, -1).matchAll(/\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes.set(key.toLowerCase(), double ?? single ?? bare ?? '');
    }
    // 입력을 별도 배열에 저장하지 않고 읽는 시점에 요청 조건과 대조한다.
    const key = attributes.get('name');
    if (dates.has(key)) {
      if (seen.has(key) || attributes.get('value') !== dates.get(key)) throw new Error('변경 조회 조건 불일치: ' + key);
      seen.add(key);
    }
    if (key === 'disuseAt' && attributes.get('type') === 'radio' && attributes.has('checked')) {
      if (selected || attributes.get('value') !== 'ALL') throw new Error('변경 조회 조건 불일치: disuseAt');
      selected = true;
    }
  }
  // 어떤 필수 조건도 누락된 상태로 집계를 사용하지 않는다.
  if (seen.size !== dates.size || !selected) throw new Error('변경 조회 필수 조건 누락');
  // 전체 건수는 수정 함수의 첫 선언에 있다. 선택 건수를 다루는 별도 함수의 cnt는 제외한다.
  const counts = [...html.matchAll(/\bfunction\s+func_modi\s*\(\s*\)\s*\{\s*var\s+cnt\s*=\s*([^;\r\n]+)\s*;/g)];
  const raw = counts[0]?.[1].trim();
  const count = Number(raw);
  if (counts.length !== 1 || !/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(count)) throw new Error('변경 조회 집계값 오류');
  return count;
}

/**
 * 전체자료 ZIP 안의 TXT를 검증하고 변환한다.
 * @param bytes 다운로드 응답의 바이트.
 * @returns 원본 순서대로 변환한 코드 목록과 상태별 건수.
 * @throws ZIP, 인코딩, 헤더 또는 행이 예상 형식과 다를 때.
 */
function convertZip(bytes: Buffer): DistrictDownload {
  // 디렉터리 항목을 제외하고 전체자료 TXT 한 개를 확인한다.
  const entries = new Zip(bytes).getEntries().filter(entry => !entry.isDirectory);
  if (entries.length !== 1 || !/\.txt$/i.test(entries[0].entryName)) throw new Error('전체자료 ZIP의 TXT 구성 오류');
  // 다운로드 파일은 CP949이며 탭을 기준으로 세 열을 구분한다.
  const text = new TextDecoder('euc-kr', { fatal: true }).decode(entries[0].getData());
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '법정동코드\t법정동명\t폐지여부') throw new Error('법정동 TXT 헤더 오류');
  // 마지막 빈 줄만 제거하고 빈 행이나 중복 코드는 거부한다.
  if (lines.at(-1) === '') lines.pop();
  const codes = new Set<string>();
  const rows: LegalDistrict[] = [];
  // 각 행을 파싱할 때 상태별 건수도 계산한다.
  let active = 0;
  for (let index = 1; index < lines.length; index++) {
    const fields = lines[index].split('\t');
    const [code, name, status] = fields;
    if (fields.length !== 3 || !/^\d{10}$/.test(code) || !name.trim() ||
        (status !== '존재' && status !== '폐지') || codes.has(code)) throw new Error('법정동 TXT 행 오류: ' + (rows.length + 2));
    codes.add(code);
    rows.push({ code, name, status });
    if (status === '존재') active++;
  }
  if (rows.length === 0) throw new Error('법정동 TXT 데이터 없음');
  return { rows, total: rows.length, active, abolished: rows.length - active };
}

/**
 * 변경 구간을 확인하고 새 자료가 필요한 경우 ZIP을 변환한다.
 * @param options 요청 날짜, 저장 날짜와 HTTP 연결 설정.
 * @returns 변경 없음이면 undefined, 최초 또는 갱신이면 행과 집계.
 * @throws 네트워크, 응답 조건 또는 변환 검증 실패.
 */
export async function collectLegalDistricts(options: {
  /** 이전 성공일이며 최초 실행에는 없다. */
  previousDate?: string;
  /** 이번 실행 시작 시점의 한국 날짜. */
  requestDate: string;
  /** 테스트에서 교체 가능한 HTTP 함수. */
  fetchImpl?: typeof fetch;
  /** 조회 건수와 다운로드 크기를 전달한다. */
  onProgress?: (progress: Progress) => void;
}): Promise<DistrictDownload | undefined> {
  // 실제 실행과 모의 테스트에서 동일한 호출 흐름을 사용한다.
  const { previousDate, requestDate, fetchImpl = fetch, onProgress } = options;
  let download = previousDate === undefined;
  if (previousDate !== undefined) {
    // 양수 응답을 발견하면 이후 구간의 조회를 생략한다.
    for (const period of periods(previousDate, requestDate)) {
      const response = await post(searchPath, {
        ...baseForm, reqSggCd: '*', reqUmdCd: '*', reqRiCd: '*', searchOk: '0',
        codeseId: '00002', disuseAt: 'ALL', stdate: period.start, enddate: period.end,
        AllChkV: 'AllChkV', chkHigh: '0', chkOrder: '0', chkCrtDt: '0', chkClsDt: '0',
        chkLocatDt: '0', chkLow: '0', chkJumin: '0', chkJijuk: '0',
      });
      const count = readCount(await response.text(), period.start, period.end);
      onProgress?.({ period, count });
      if (count > 0) {
        download = true;
        break;
      }
    }
  }
  // 0건에서는 저장 계층이 기존 행을 그대로 사용한다.
  if (!download) return undefined;
  const response = await post('/etc/codeFullDown.do', {
    ...baseForm, reqSggCd: '', reqUmdCd: '', reqRiCd: '', searchOk: '',
    codeseId: '법정동코드', disuseAt: '0', stdate: '', enddate: '',
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const result = convertZip(bytes);
  onProgress?.({ bytes: bytes.length });
  return result;

  /**
   * 같은 출처에 폼을 제출하고 정상 HTTP 응답만 전달한다.
   * @param path 행정표준코드관리시스템 요청 경로.
   * @param form 요청에 사용하는 폼 항목.
   * @returns 응답 본문을 읽을 수 있는 HTTP 응답.
   * @throws 응답이 실패하거나 연결에 실패한 경우.
   */
  async function post(path: string, form: Record<string, string>): Promise<Response> {
    // 요청 제한 시간을 응답 본문을 읽을 때까지 적용한다.
    const response = await fetchImpl(new URL(path, origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Referer: origin + searchPath },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(path + ' HTTP ' + response.status);
    }
    return response;
  }
}

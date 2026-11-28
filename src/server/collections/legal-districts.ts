// 원본 수집과 저장을 연결하는 Node.js 서버 모듈이다.
import { createBlobCollectionStore } from './blob-collection-store';
import { collectionFetch } from './collection-fetch';
import { importLocalCollection } from './import-local-collection';
import { collectLegalDistricts, isDate, koreanDate, type LegalDistrict } from '../../shared/api/code/legal-districts-collection';
import { createLocalCollectionStore, type CollectionStore, type LocalCollectionOptions } from './local-collection-store';

// CLI와 서버 기본 경로에 사용하는 프로젝트 상대 경로다.
export const legalDistrictOutput = '.data/code/legal-districts.json';

/** 호출자에게 제공할 갱신 기준과 집계다. */
export type LegalDistrictMetadata = {
  /** 적용된 한국 날짜. */
  lastSuccessfulDate: string;
  /** 전체 지역 코드 수. */
  total: number;
  /** 현존 지역 코드 수. */
  active: number;
  /** 폐지 지역 코드 수. */
  abolished: number;
};

/** 로컬 경로 또는 교체 가능한 저장 구현이다. */
export type LegalDistrictStorageOptions = {
  /** 기본은 로컬 구현이며 별도 저장소를 사용할 때만 지정한다. */
  store?: CollectionStore<LegalDistrictMetadata, LegalDistrict>;
};

/** 수집 실행 중 사용할 요청과 시간 설정이다. */
type LegalDistrictCollectionOptions = LegalDistrictStorageOptions &
  Pick<NonNullable<Parameters<typeof collectLegalDistricts>[0]>, 'fetchImpl' | 'onProgress'> & {
    /** 수집 기준일을 계산할 실행 시작 시각. */
    now?: Date;
  };

/** 수집 결과를 구분하는 값이다. */
type CollectionStatus = 'created' | 'updated' | 'unchanged';

/**
 * 저장된 행으로 읽을 수 있는지 검사한다.
 * @param row 검사할 목록 데이터.
 * @returns 행 형식의 유효 여부.
 */
function isRow(row: unknown): row is LegalDistrict {
  const value = row as Partial<LegalDistrict> | null;
  return typeof value?.code === 'string' && /^\d{10}$/.test(value.code) &&
    typeof value.name === 'string' && Boolean(value.name.trim()) &&
    (value.status === '존재' || value.status === '폐지');
}

/**
 * 지역 목록의 성공일과 상태별 집계를 검증한다.
 * @param {object} data 저장된 메타데이터.
 * @returns {boolean} 비교와 진단에 사용할 수 있는지 여부.
 */
function validate(data: Record<string, unknown>): data is LegalDistrictMetadata {
  if (typeof data.total !== 'number') return false;
  if (typeof data.active !== 'number') return false;
  if (typeof data.abolished !== 'number') return false;
  return isDate(data.lastSuccessfulDate) && data.total > 0 &&
    [data.total, data.active, data.abolished].every(Number.isSafeInteger) &&
    data.active >= 0 && data.abolished >= 0 && data.active + data.abolished === data.total;
}

/**
 * 이전 단일 파일의 행과 날짜로 메타데이터를 계산한다.
 * @param {object} snapshot 이전 형식의 저장본.
 * @param rows 이전 파일의 원본 행.
 * @returns {object} 이전에 적용된 날짜와 집계.
 * @throws 날짜나 행의 형식이 잘못된 경우.
 */
function migrate(snapshot: Record<string, unknown>, rows: unknown[]): { metadata: LegalDistrictMetadata; rows: LegalDistrict[] } {
  // 전환 중 한 번의 순회로 행을 검사하고 상태별 건수를 센다.
  const codes = new Set();
  let active = 0;
  for (const row of rows) {
    if (!isRow(row) || codes.has(row.code)) throw new Error('기존 법정동코드 행 형식 오류');
    codes.add(row.code);
    if (row.status === '존재') active++;
  }
  const total = rows.length;
  const metadata = { lastSuccessfulDate: snapshot.lastSuccessfulDate, total, active, abolished: total - active };
  if (!validate(metadata)) throw new Error('기존 법정동코드 JSON 형식 오류');
  return { metadata, rows: rows as LegalDistrict[] };
}

/**
 * 이전 성공일부터 원본을 확인하고 새 목록 또는 성공일을 적용한다.
 * @param {object} [options] 출력, 시각, 네트워크 및 저장 설정.
 * @returns {Promise<object>} 적용 분기와 날짜, 건수.
 * @throws 조회나 저장에 실패하거나 출력이 잠겼을 때.
 */
export async function runLegalDistrictCollection(options: LegalDistrictCollectionOptions = {}) {
  // 실행 옵션과 저장 구현을 분리한다.
  const { fetchImpl, onProgress, now = new Date() } = options;
  // 모든 구간에 시작 시점의 한국 날짜를 사용한다.
  const requestDate = koreanDate(now);
  return getStore(options).run(collect);

  /**
   * 현재 성공일과 건수만 사용해 원본 확인과 결과 적용을 수행한다.
   * @param {object|undefined} previous 현재 적용된 메타데이터.
   * @param {Function} save 메타데이터와 선택적인 목록을 적용하는 함수.
   * @returns {Promise<object>} 실행 결과와 출력용 건수.
   */
  async function collect(previous: LegalDistrictMetadata | undefined, save: (metadata: LegalDistrictMetadata, rows?: LegalDistrict[]) => Promise<void>, signal?: AbortSignal) {
    const downloaded = await collectLegalDistricts({ previousDate: previous?.lastSuccessfulDate, requestDate, fetchImpl: collectionFetch(fetchImpl, signal), onProgress });
    // 다운로드를 생략하면 기존 목록을 열지 않고 집계값도 재사용한다.
    const totals = downloaded ?? previous;
    if (!totals) throw new Error('법정동 수집 결과 누락');
    const { total, active, abolished } = totals;
    if (downloaded || previous?.lastSuccessfulDate !== requestDate) {
      await save({ lastSuccessfulDate: requestDate, total, active, abolished }, downloaded?.rows);
    }
    return { status: (previous ? (downloaded ? 'updated' : 'unchanged') : 'created') satisfies CollectionStatus, requestDate, total, active, abolished };
  }
}


/**
 * 경로와 업무 검증을 해당 저장 구현에 연결한다.
 * @param options 저장소 또는 로컬 경로.
 * @returns 이 데이터셋의 저장 계약.
 */
function getStore(options: LegalDistrictStorageOptions): CollectionStore<LegalDistrictMetadata, LegalDistrict> {
  if (options.store) return options.store;
  return createBlobCollectionStore('legal-districts', { readMetadata, readRows });
}

/**
 * 이전 작업과 로컬 저장 계약 테스트에만 사용할 읽기 원본을 구성한다.
 * @param options 로컬 경로와 선택적 파일 연산.
 * @returns 로컬 파일 저장소.
 */
export function createLegalDistrictLocalSource(options: LocalCollectionOptions) {
  return createLocalCollectionStore({
    ...options,
    output: options.output ?? legalDistrictOutput,
    format: { readMetadata, migrate, readRows },
  });
}

/**
 * 파일 전용 필드를 제거한 업무 메타데이터를 반환한다.
 * @param data 저장본에서 읽은 메타데이터.
 * @returns 검증을 통과한 공개 필드.
 * @throws 저장본 형식이 올바르지 않은 경우.
 */
function readMetadata(data: Record<string, unknown>): LegalDistrictMetadata {
  if (!validate(data)) throw new Error('수집 메타데이터 형식 오류');
  const { lastSuccessfulDate, total, active, abolished } = data;
  return { lastSuccessfulDate, total, active, abolished };
}

/**
 * 목록을 읽을 때에만 저장된 행과 건수의 호환성을 검사한다.
 * @param rows 참조 파일에 저장된 배열.
 * @param metadata 같은 세대의 집계값.
 * @returns 원본 순서를 보존한 행.
 * @throws 행 또는 전체 건수가 유효하지 않은 경우.
 */
function readRows(rows: unknown[], metadata: LegalDistrictMetadata): LegalDistrict[] {
  if (rows.length !== metadata.total || !rows.every(isRow)) throw new Error('수집 목록 형식 오류');
  return rows;
}

/**
 * 원본에 요청하거나 목록 본문을 열지 않고 적용된 갱신 정보를 반환한다.
 * @param options 조회할 저장소 또는 로컬 경로.
 * @returns 저장된 메타데이터 또는 미수집 상태.
 * @throws 저장본 형식 또는 목록 참조가 올바르지 않은 경우.
 */
export function getLegalDistrictMetadata(options: LegalDistrictStorageOptions = {}): Promise<LegalDistrictMetadata | undefined> {
  return getStore(options).getMetadata();
}

/**
 * 현재 적용된 목록을 원본 순서대로 반환한다.
 * @param options 조회할 저장소 또는 로컬 경로.
 * @returns 저장된 목록 또는 미수집 상태.
 * @throws 참조 또는 목록 데이터가 올바르지 않은 경우.
 */
export function getLegalDistrictRows(options: LegalDistrictStorageOptions = {}): Promise<LegalDistrict[] | undefined> {
  return getStore(options).getRows();
}

/**
 * 로컬 자료를 최초 한 번 Blob에 적용하고 적용한 자료를 원본과 대조한다.
 * @param output 기존 로컬 저장본의 경로이며 생략하면 프로젝트 기본 경로를 사용한다.
 * @returns 완료 여부와 이전에 적용한 자료가 있을 경우의 건수.
 */
export async function migrateLegalDistrictToBlob(output = legalDistrictOutput) {
  const store = createBlobCollectionStore('legal-districts', { readMetadata, readRows });
  return importLocalCollection(store, () => createLegalDistrictLocalSource({ output }).getSnapshot());
}

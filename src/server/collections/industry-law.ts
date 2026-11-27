// 원본 수집과 저장을 연결하는 Node.js 서버 모듈이다.
import { resolve } from 'node:path';
import { collectIndustryLaw, isIndustryLawRow, reportId, type IndustryLawRow } from '../../shared/api/g2b/industry-law-collection';
import { createLocalCollectionStore, type CollectionStore, type LocalCollectionOptions } from './local-collection-store';

// CLI와 서버 기본 경로에 사용하는 프로젝트 상대 경로다.
export const industryLawOutput = '.data/g2b/industry-law.json';

/** 호출자에게 제공할 갱신 기준과 집계다. */
export type IndustryLawMetadata = {
  /** 고정 보고서 식별자. */
  reportId: string;
  /** 적용된 수정 기준. */
  lastUpdate: string;
  /** 전체 행 수. */
  totalRows: number;
  /** 고유 업종코드 수. */
  codes: number;
};

/** 로컬 경로 또는 교체 가능한 저장 구현이다. */
export type IndustryLawStorageOptions = LocalCollectionOptions & {
  /** 기본은 로컬 구현이며 별도 저장소를 사용할 때만 지정한다. */
  store?: CollectionStore<IndustryLawMetadata, IndustryLawRow>;
};

/** 수집 실행 중 사용할 요청과 시간 설정이다. */
type IndustryLawCollectionOptions = IndustryLawStorageOptions &
  Pick<NonNullable<Parameters<typeof collectIndustryLaw>[0]>, 'fetchImpl' | 'onStep'>;

/** 수집 결과를 구분하는 값이다. */
type CollectionStatus = 'created' | 'updated' | 'unchanged';

/**
 * 업종 보고서 식별자, 수정 기준과 집계를 검증한다.
 * @param {object} data 저장된 메타데이터.
 * @returns {boolean} 비교와 진단에 사용할 수 있는지 여부.
 */
function validate(data: Record<string, unknown>): data is IndustryLawMetadata {
  if (typeof data.totalRows !== 'number') return false;
  if (typeof data.codes !== 'number') return false;
  return data.reportId === reportId && typeof data.lastUpdate === 'string' && Boolean(data.lastUpdate.trim()) &&
    Number.isSafeInteger(data.totalRows) && data.totalRows > 0 &&
    Number.isSafeInteger(data.codes) && data.codes > 0 && data.codes <= data.totalRows;
}

/**
 * 단일 파일에 저장된 업종 목록에서 메타데이터를 계산한다.
 * @param {object} snapshot 이전 형식의 저장본.
 * @param rows 이전 파일의 원본 행.
 * @returns {object} 이전에 적용된 수정 기준과 집계.
 * @throws 원본 형식이 올바르지 않은 경우.
 */
function migrate(snapshot: Record<string, unknown>, rows: unknown[]): { metadata: IndustryLawMetadata; rows: IndustryLawRow[] } {
  // 전환 시 기존 행은 그대로 보존하고 출력에 필요한 코드만 집계한다.
  const codes = new Set();
  for (const row of rows) {
    if (!isIndustryLawRow(row)) throw new Error('기존 업종코드 행 형식 오류');
    codes.add(row.industryCode);
  }
  const metadata = { reportId: snapshot.reportId, lastUpdate: snapshot.lastUpdate, totalRows: rows.length, codes: codes.size };
  if (!validate(metadata)) throw new Error('기존 업종 저장본 형식 오류');
  return { metadata, rows: rows as IndustryLawRow[] };
}

/**
 * 저장된 수정 기준으로 보고서를 조회하고 바뀐 목록만 저장한다.
 * @param {object} [options] 출력 경로와 요청·저장 설정.
 * @returns {Promise<object>} 실행 분기와 업종 집계.
 * @throws 수집 또는 저장에 실패하거나 출력이 잠겼을 때.
 */
export async function runIndustryLawCollection(options: IndustryLawCollectionOptions = {}) {
  // 실행 옵션과 저장 구현을 분리한다.
  const { fetchImpl, onStep } = options;
  return getStore(options).run(collect);

  /**
   * 기존 기준과 조회 버전을 비교해 변경된 자료만 적용한다.
   * @param {object|undefined} current 기존 메타데이터.
   * @param {Function} save 새 메타데이터와 행을 적용하는 함수.
   * @returns {Promise<object>} 적용 분기와 진단 값.
   */
  async function collect(current: IndustryLawMetadata | undefined, save: (metadata: IndustryLawMetadata, rows?: IndustryLawRow[]) => Promise<void>) {
    const collected = await collectIndustryLaw({ appliedLastUpdate: current?.lastUpdate, fetchImpl, onStep });
    // 동일 버전에서는 기존 집계만 사용하며 저장을 생략한다.
    const metadata = collected.rows
      ? { reportId, lastUpdate: collected.lastUpdate, totalRows: collected.totalRows, codes: collected.codes }
      : current;
    if (!metadata) throw new Error('업종 수집 결과 누락');
    if (collected.rows) await save(metadata, collected.rows);
    return {
      status: (collected.rows ? (current ? 'updated' : 'created') : 'unchanged') satisfies CollectionStatus,
      lastUpdate: metadata.lastUpdate, totalRows: metadata.totalRows, codes: metadata.codes, bytes: collected.bytes,
    };
  }
}


/**
 * 경로와 업무 검증을 해당 저장 구현에 연결한다.
 * @param options 저장소 또는 로컬 경로.
 * @returns 이 데이터셋의 저장 계약.
 */
function getStore(options: IndustryLawStorageOptions): CollectionStore<IndustryLawMetadata, IndustryLawRow> {
  return options.store ?? createLocalCollectionStore({
    ...options,
    output: options.output ?? resolve(industryLawOutput),
    format: { readMetadata, migrate, readRows },
  });
}

/**
 * 파일 전용 필드를 제거한 업무 메타데이터를 반환한다.
 * @param data 저장본에서 읽은 메타데이터.
 * @returns 검증을 통과한 공개 필드.
 * @throws 저장본 형식이 올바르지 않은 경우.
 */
function readMetadata(data: Record<string, unknown>): IndustryLawMetadata {
  if (!validate(data)) throw new Error('수집 메타데이터 형식 오류');
  const { reportId, lastUpdate, totalRows, codes } = data;
  return { reportId, lastUpdate, totalRows, codes };
}

/**
 * 목록을 읽을 때에만 저장된 행과 건수의 호환성을 검사한다.
 * @param rows 참조 파일에 저장된 배열.
 * @param metadata 같은 세대의 집계값.
 * @returns 원본 순서를 보존한 행.
 * @throws 행 또는 전체 건수가 유효하지 않은 경우.
 */
function readRows(rows: unknown[], metadata: IndustryLawMetadata): IndustryLawRow[] {
  if (rows.length !== metadata.totalRows || !rows.every(isIndustryLawRow)) throw new Error('수집 목록 형식 오류');
  return rows;
}

/**
 * 원본에 요청하거나 목록 본문을 열지 않고 적용된 갱신 정보를 반환한다.
 * @param options 조회할 저장소 또는 로컬 경로.
 * @returns 저장된 메타데이터 또는 미수집 상태.
 * @throws 저장본 형식 또는 목록 참조가 올바르지 않은 경우.
 */
export function getIndustryLawMetadata(options: IndustryLawStorageOptions = {}): Promise<IndustryLawMetadata | undefined> {
  return getStore(options).getMetadata();
}

/**
 * 현재 적용된 목록을 원본 순서대로 반환한다.
 * @param options 조회할 저장소 또는 로컬 경로.
 * @returns 저장된 목록 또는 미수집 상태.
 * @throws 참조 또는 목록 데이터가 올바르지 않은 경우.
 */
export function getIndustryLawRows(options: IndustryLawStorageOptions = {}): Promise<IndustryLawRow[] | undefined> {
  return getStore(options).getRows();
}

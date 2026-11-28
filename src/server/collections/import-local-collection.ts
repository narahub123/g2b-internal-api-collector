import { isDeepStrictEqual } from 'node:util';
import type { CollectionStore } from './local-collection-store';

/**
 * 비어 있는 사전에만 기존 자료를 적용한 뒤 메타데이터와 행을 다시 읽어 검증한다.
 * @param store 동일한 잠금과 교체를 적용할 대상 저장소.
 * @param source 기존 파일을 읽는 함수.
 * @returns 이전 또는 건너뜀 결과.
 * @throws 원본이 없거나 적용 자료가 원본과 불일치할 때.
 */
export async function importLocalCollection<M, R>(
  store: CollectionStore<M, R>,
  source: () => Promise<{ metadata: M; rows?: R[] } | undefined>,
) {
  return store.run(apply);

  /**
   * 대상 저장소 잠금 아래에서 이전과 대조를 수행한다.
   * @param existing 이미 적용된 저장본의 기준.
   * @param save 검증된 목록을 적용하는 함수.
   * @returns 이전 여부와 이전한 행 수.
   */
  async function apply(existing: M | undefined, save: (metadata: M, rows?: R[]) => Promise<void>) {
    if (existing) return { status: 'skipped' as const };
    const snapshot = await source();
    if (!snapshot?.rows) throw new Error('이전할 로컬 사전 자료가 없습니다.');
    await save(snapshot.metadata, snapshot.rows);
    const [metadata, rows] = await Promise.all([store.getMetadata(), store.getRows()]);
    if (!isDeepStrictEqual(metadata, snapshot.metadata) || !isDeepStrictEqual(rows, snapshot.rows)) {
      throw new Error('Blob에 적용된 사전 자료가 로컬 원본과 다릅니다.');
    }
    return { status: 'imported' as const, rows: snapshot.rows.length };
  }
}

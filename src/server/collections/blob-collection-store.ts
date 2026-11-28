import { randomUUID } from 'node:crypto';
import { BlobPreconditionFailedError, del, get, put } from '@vercel/blob';
import type { CollectionFormat, CollectionRunner, CollectionStore } from './local-collection-store';

/** 사전 수집이 다른 실행과 충돌했음을 관리자 화면에 전달한다. */
export class CollectionBusyError extends Error {
  /** 수집 화면과 CLI에서 사용할 경합 오류를 구성한다. */
  constructor() {
    super('같은 사전을 수집 중입니다.');
  }
}

/** 원본 업데이트를 확인할 때도 적용 기준을 읽기 위한 Blob 연산이다. */
export type CollectionBlobClient = Pick<{ get: typeof get; put: typeof put; del: typeof del }, 'get' | 'put' | 'del'>;

/** Blob 경로의 적용 기준과 현재 세대 참조다. */
type Manifest<M> = {
  /** 검증을 마친 업무 메타데이터. */
  metadata: M;
  /** 이전 목록과 구분되는 적용 목록의 경로. */
  listFile: string;
  /** 다음 조건부 쓰기에 사용할 적용본 ETag. */
  etag: string;
  /** 응답 유실 후 해당 교체가 적용됐는지 확인하는 식별자. */
  commitId?: string;
};

// 수집 제한을 잠금 수명보다 짧게 유지해 만료된 실행의 새 쓰기를 막는다.
const runTimeout = 120_000;
const leaseDuration = 300_000;
const blobTimeout = 15_000;
const generation = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;
// 프로세스당 각 사전에 최근 한 세대만 유지하고 검증에 실패한 읽기는 재사용하지 않는다.
const rowsCache = new Map<string, { listFile: string; promise: Promise<unknown[]> }>();
// 표시용 조회에만 적용하는 사전별 캐시 수명이다.
const metadataTtl = 30_000;

/** 화면 요청이 공유하는 진행 중 조회 또는 유효기간이 있는 표시값이다. */
type MetadataCacheEntry =
  | {
      /** 중복 요청을 합칠 진행 중 조회. */
      pending: Promise<unknown>;
    }
  | {
      /** 검증된 메타데이터 또는 미수집 상태. */
      metadata: unknown;
      /** 성공 처리 후 계산한 만료 시각. */
      expiresAt: number;
    };

// 목록 본문은 이 캐시에 저장하지 않는다.
const metadataCache = new Map<string, MetadataCacheEntry>();

/**
 * 관리 화면과 CLI가 공유하는 Private Blob 저장소를 구성한다.
 * @param id 저장 경로에 사용할 사전 식별자.
 * @param format 기존 업무 메타데이터와 행 검증 함수.
 * @param client 테스트에서 교체 가능한 Blob SDK 연산.
 * @returns 목록 조회와 배타 수집을 제공하는 저장소.
 */
export function createBlobCollectionStore<M, R>(
  id: string,
  format: Pick<CollectionFormat<M, R>, 'readMetadata' | 'readRows'>,
  client: CollectionBlobClient = { get, put, del },
): CollectionStore<M, R> {
  // 검증 환경은 같은 저장소 내 별도 접두사를 사용할 수 있다.
  const prefix = process.env.DICTIONARY_BLOB_PREFIX?.trim() || 'dictionaries';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error('사전 Blob 접두사 형식 오류');
  const base = `${prefix}/${id}`;
  // 테스트 환경에서 저장소 연결을 바꿔도 다른 저장소의 목록을 재사용하지 않는다.
  const cacheKey = `${process.env.BLOB_STORE_ID ?? ''}/${base}`;
  const metadataPath = `${base}/metadata.json`;
  const leasePath = `${base}/lease.json`;
  const rowsPrefix = `${base}/rows/`;
  return { getMetadata, getRows, run };

  /**
   * Blob JSON을 읽고 미수집 상태를 별도로 반환한다.
   * @param pathname 메타데이터, 잠금 또는 목록의 서버 경로.
   * @param useCache 불변 세대에서만 CDN 캐시를 사용할지 여부.
   * @param signal 수집 전체의 제한 시간.
   * @returns JSON 내용과 쓰기 조건에 필요한 ETag.
   */
  async function read(pathname: string, useCache: boolean, signal?: AbortSignal) {
    const result = await client.get(pathname, { access: 'private', useCache, abortSignal: limit(signal) });
    if (!result) return undefined;
    if (result.statusCode !== 200 || !result.stream) throw new Error('사전 Blob 응답 형식 오류');
    const data: unknown = await new Response(result.stream).json();
    return { data, etag: result.blob.etag };
  }

  /**
   * 개별 명령에 수집 제한과 별도 시간 제한을 함께 적용한다.
   * @param signal 상위 수집 취소 신호.
   * @returns Blob 명령에 전달할 취소 신호.
   */
  function limit(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(blobTimeout);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /**
   * CDN을 우회해 최신 적용 기준과 목록 참조를 읽는다.
   * @param signal 수집 전체의 제한 시간.
   * @returns 검증된 적용본과 현재 ETag 또는 미수집 상태.
   */
  async function readManifest(signal?: AbortSignal): Promise<Manifest<M> | undefined> {
    const blob = await read(metadataPath, false, signal);
    if (!blob) return undefined;
    const data = blob.data as Record<string, unknown> | null;
    const listFile = data?.listFile;
    if (data?.formatVersion !== 1 || typeof listFile !== 'string' ||
        !listFile.startsWith(rowsPrefix) || !generation.test(listFile.slice(rowsPrefix.length))) {
      throw new Error('수집 메타데이터 형식 오류');
    }
    return { listFile, metadata: format.readMetadata(data), etag: blob.etag,
      commitId: typeof data.commitId === 'string' ? data.commitId : undefined };
  }

  /**
   * 목록을 열지 않고 유효한 표시 메타데이터를 반환한다.
   * @returns 검증한 메타데이터 또는 미수집 상태.
   * @throws Blob 조회나 메타데이터 검증에 실패한 경우.
   */
  async function getMetadata(): Promise<M | undefined> {
    // 같은 사전의 진행 중 조회는 합치고 성공한 값만 유효기간 동안 사용한다.
    const cached = metadataCache.get(cacheKey);
    if (cached) {
      if ('pending' in cached) return cached.pending as Promise<M | undefined>;
      if (cached.expiresAt > Date.now()) return cached.metadata as M | undefined;
    }

    // 항목의 객체 참조를 비교해 수집 전 조회가 새 상태를 덮어쓰지 못하게 한다.
    const entry = { pending: loadMetadata() };
    metadataCache.set(cacheKey, entry);
    try {
      const metadata = await entry.pending;
      if (metadataCache.get(cacheKey) === entry) rememberMetadata(metadata);
      return metadata;
    } catch (error) {
      if (metadataCache.get(cacheKey) === entry) metadataCache.delete(cacheKey);
      throw error;
    }
  }

  /**
   * 표시값이 없거나 만료됐을 때 최신 메타데이터를 읽는다.
   * @returns 적용된 업무 메타데이터 또는 미수집 상태.
   */
  async function loadMetadata() {
    return (await readManifest())?.metadata;
  }

  /**
   * 성공한 조회의 표시값과 새 만료 시각을 기록한다.
   * @param metadata 업무 메타데이터 또는 확인된 미수집 상태.
   */
  function rememberMetadata(metadata: M | undefined) {
    metadataCache.set(cacheKey, { metadata, expiresAt: Date.now() + metadataTtl });
  }

  /** 적용 목록이 교체 도중 제거된 경우 새 참조로 한 번 다시 읽는다. */
  async function getRows() {
    const applied = await readManifest();
    if (!applied) return undefined;
    const rows = await cachedRows(applied);
    if (rows) return rows;
    const latest = await readManifest();
    if (latest && latest.listFile !== applied.listFile) {
      const retried = await cachedRows(latest);
      if (retried) return retried;
    }
    throw new Error('참조 목록 Blob이 없습니다.');
  }

  /**
   * 같은 세대의 읽기와 검증을 진행 중인 요청끼리 공유한다.
   * @param applied 현재 읽을 목록 세대.
   * @returns 검증된 행 또는 목록이 없는 경우 undefined.
   */
  async function cachedRows(applied: Manifest<M>): Promise<R[] | undefined> {
    // 교체된 세대는 다른 경로를 사용하므로 이전 캐시로 조회를 처리하지 않는다.
    const cached = rowsCache.get(cacheKey);
    if (cached?.listFile === applied.listFile) return cached.promise as Promise<R[] | undefined>;
    const entry = { listFile: applied.listFile, promise: loadRows(applied) };
    rowsCache.set(cacheKey, entry);
    try {
      const rows = await entry.promise;
      if (!rows && rowsCache.get(cacheKey) === entry) rowsCache.delete(cacheKey);
      return rows;
    } catch (error) {
      if (rowsCache.get(cacheKey) === entry) rowsCache.delete(cacheKey);
      throw error;
    }
  }

  /**
   * 불변 목록을 읽어 현재 메타데이터의 행 형식과 대조한다.
   * @param applied 조회할 목록과 같은 세대의 적용 기준.
   * @returns 검증한 행 또는 목록이 없을 경우 undefined.
   */
  async function loadRows(applied: Manifest<M>) {
    const blob = await read(applied.listFile, true);
    if (!blob) return undefined;
    if (!Array.isArray(blob.data)) throw new Error('수집 목록 형식 오류');
    return format.readRows(blob.data, applied.metadata);
  }

  /**
   * 고정 경로에 잠금을 만들고 만료된 잠금은 조건부로만 회수한다.
   * @param signal 수집 전체의 제한 시간.
   * @returns 소유한 잠금의 ETag.
   */
  async function acquire(signal: AbortSignal) {
    const owner = randomUUID();
    const expiresAt = Date.now() + leaseDuration;
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      try {
        return (await client.put(leasePath, JSON.stringify({ owner, expiresAt }), {
          access: 'private', allowOverwrite: false, contentType: 'application/json', abortSignal: limit(signal),
        })).etag;
      } catch (error) {
        // 생성 응답이 유실됐을 때 자신이 만든 잠금인지도 확인한다.
        const existing = await read(leasePath, false, signal);
        if (!existing) {
          if (attempt === 0 && error instanceof BlobPreconditionFailedError) continue;
          throw error;
        }
        const lease = existing.data as { owner?: string; expiresAt?: number } | null;
        if (lease?.owner === owner) return existing.etag;
        if (attempt > 0 || !Number.isSafeInteger(lease?.expiresAt) || lease.expiresAt > Date.now()) {
          throw new CollectionBusyError();
        }
        try {
          await client.del(leasePath, { ifMatch: existing.etag, abortSignal: limit(signal) });
        } catch (deleteError) {
          if (deleteError instanceof BlobPreconditionFailedError) throw new CollectionBusyError();
          throw deleteError;
        }
      }
    }
    throw new CollectionBusyError();
  }

  /**
   * 수집 실패를 덮어쓰지 않게 정리 오류만 기록한다.
   * @param pathname 삭제할 세대 또는 소유한 잠금.
   * @param etag 잠금을 해제할 때 요구하는 소유권 조건.
   */
  async function cleanup(pathname: string, etag?: string) {
    try {
      await client.del(pathname, { ifMatch: etag, abortSignal: limit() });
    } catch {
      console.warn('[사전 Blob] 정리 지연', pathname);
    }
  }

  /**
   * 사전 잠금 아래에서 최신 기준으로 수집하고 검증된 자료만 적용한다.
   * @param collect 업무별 원본 확인과 저장 로직.
   * @returns 업무 수집 결과.
   */
  async function run<T>(collect: CollectionRunner<M, R, T>): Promise<T> {
    const signal = AbortSignal.timeout(runTimeout);
    // 이벤트 루프 정지 후에도 경과 시간이 지난 실행은 쓰기를 시작할 수 없다.
    const deadline = performance.now() + runTimeout;
    const leaseEtag = await acquire(signal);
    let current: Manifest<M> | undefined;
    try {
      current = await readManifest(signal);
      // 저장이 없었어도 성공하면 원본 확인에 사용한 최신 기준으로 표시값을 갱신한다.
      const initial = current;
      const result = await collect(current?.metadata, save, signal);
      if (current === initial) rememberMetadata(current?.metadata);
      return result;
    } finally {
      await cleanup(leasePath, leaseEtag);
    }

    /**
     * 새 목록을 먼저 저장하고 메타데이터의 조건부 교체로 적용한다.
     * @param metadata 새 업무 메타데이터.
     * @param rows 새 행 또는 기존 목록을 유지할 경우 undefined.
     */
    async function save(metadata: M, rows?: R[]) {
      ensureActive();
      const previous = current;
      const commitId = randomUUID();
      const listFile = rows ? rowsPrefix + commitId + '.json' : previous?.listFile;
      if (!listFile) throw new Error('저장할 목록 참조 누락');
      if (rows) {
        // 이 세대는 아직 참조되지 않아 업로드 실패 시 적용본에 영향이 없다.
        try {
          await client.put(listFile, JSON.stringify(rows), {
            access: 'private', allowOverwrite: false, contentType: 'application/json', abortSignal: limit(signal),
          });
        } catch (error) {
          await cleanup(listFile);
          throw error;
        }
      }
      let startedCommit = false;
      let etag: string;
      try {
        ensureActive();
        startedCommit = true;
        etag = (await client.put(metadataPath, JSON.stringify({ ...metadata, formatVersion: 1, listFile, commitId }), {
          access: 'private', allowOverwrite: Boolean(previous), ifMatch: previous?.etag,
          contentType: 'application/json', abortSignal: limit(signal),
        })).etag;
      } catch (error) {
        if (!startedCommit || error instanceof BlobPreconditionFailedError) {
          if (rows) await cleanup(listFile);
          throw error;
        }
        // 응답 유실 시 늦게 적용될 수도 있으므로 적용되지 않았다고 단정해 목록을 삭제하지 않는다.
        const latest = await readManifest();
        if (latest?.commitId !== commitId) {
          if (rows && latest && latest.etag !== previous?.etag && latest.listFile !== listFile) await cleanup(listFile);
          throw error;
        }
        etag = latest.etag;
      }
      current = { listFile, metadata, etag, commitId };
      // 적용이 확인된 뒤에만 다음 표시 조회가 최신 Blob을 읽도록 한다.
      metadataCache.delete(cacheKey);
      if (previous && previous.listFile !== listFile) await cleanup(previous.listFile);
    }

    /** 슬롯 만료 전에만 새 쓰기를 시작할 수 있게 한다. */
    function ensureActive() {
      signal.throwIfAborted();
      if (performance.now() >= deadline) throw new Error('사전 수집 제한 시간 초과');
    }
  }
}

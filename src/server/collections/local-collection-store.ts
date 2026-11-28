// 로컬 구현의 스냅샷과 배타 실행권에 사용하는 파일 작업이다.
import * as fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** 업무 모듈이 사용하는 저장소 계약이다. */
export type CollectionStore<M, R> = {
  /** 적용된 갱신 기준과 집계를 읽으며 지원하는 저장소는 표시 캐시를 우회할 수 있다. */
  getMetadata(fresh?: boolean): Promise<M | undefined>;
  /** 적용된 목록의 행을 읽는다. */
  getRows(): Promise<R[] | undefined>;
  /** 수집기를 배타 실행하고 지원하는 저장소에는 호출자의 중단 신호를 전달한다. */
  run<T>(collect: CollectionRunner<M, R, T>, signal?: AbortSignal): Promise<T>;
};

/** 메타데이터와 선택적 새 목록을 함께 적용하는 함수다. */
type SaveCollection<M, R> = (metadata: M, rows?: R[]) => Promise<void>;
/** 현재 메타데이터를 사용해 수집 결과를 반환하는 함수다. */
export type CollectionRunner<M, R, T> = (current: M | undefined, save: SaveCollection<M, R>, signal?: AbortSignal) => Promise<T>;

/** 로컬 저장 경로와 테스트용 파일 연산 설정이다. */
export type LocalCollectionOptions = {
  /** 지정하지 않으면 업무 모듈의 기본 출력 경로를 사용한다. */
  output?: string;
  /** 파일 접근을 계측하거나 실패를 재현하는 연산 집합. */
  io?: typeof fs;
  /** 메타데이터 교체 테스트에 사용하는 이름 변경 함수. */
  rename?: typeof fs.rename;
};

/** 저장 방식의 세부 정보와 업무 자료를 연결하는 로컬 형식 검증이다. */
export type CollectionFormat<M, R> = {
  /** 저장 원본을 검증하고 공개할 메타데이터 필드만 반환한다. */
  readMetadata: (data: Record<string, unknown>) => M;
  /** 이전 저장본에서 메타데이터와 목록을 복원한다. */
  migrate: (data: Record<string, unknown>, rows: unknown[]) => { metadata: M; rows: R[] };
  /** 분리된 목록이 메타데이터와 호환되는지 검증한다. */
  readRows: (rows: unknown[], metadata: M) => R[];
};

/** 로컬 메타데이터가 가리키는 적용 세대다. */
type StoredMetadata<M> = {
  /** 분리 저장 형식임을 나타낸다. */
  kind: 'split';
  /** 업무에서 사용하는 갱신 기준과 집계. */
  metadata: M;
  /** 현재 적용 세대의 파일명. */
  listFile: string;
};

/**
 * 읽기 전용 조회와 배타 실행을 제공하는 로컬 저장소를 구성한다.
 * @param options 출력 경로, 파일 연산, 업무 데이터 형식 설정.
 * @returns 공개 조회와 저장 작업을 제공하는 저장소.
 */
export function createLocalCollectionStore<M extends Record<string, unknown>, R>(
  options: LocalCollectionOptions & { output: string; format: CollectionFormat<M, R> },
): CollectionStore<M, R> & { getSnapshot(): Promise<{ metadata: M; rows?: R[] } | undefined> } {
  // 생성 단계에서는 디렉터리나 파일을 만들지 않는다.
  const { output, io = fs, rename = io.rename, format: config } = options;
  const path = resolve(output);
  const prefix = basename(path) + '.rows-';
  return { getMetadata, getRows, getSnapshot, run: withCollectionStore };

  /**
   * 이전 명령에 같은 세대의 메타데이터와 행을 제공한다.
   * @returns 존재하는 로컬 스냅샷 또는 미수집 상태.
   */
  function getSnapshot() {
    return readCurrent(true);
  }

  /**
   * 이 출력에 속하는 세대 파일명인지 검사한다.
   * @param name 검증할 파일명.
   * @returns 이 출력의 목록 파일명인지 여부.
   */
  function isListName(name: unknown): name is string {
    return typeof name === 'string' && name.startsWith(prefix) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(name.slice(prefix.length));
  }

  /**
   * 파일을 한 번 읽어 기존 단일 형식 또는 분리 형식으로 해석한다.
   * @returns 적용 데이터 참조, 기존 자료 또는 미수집 상태.
   * @throws 메타데이터 형식이 올바르지 않거나 읽기에 실패한 경우.
   */
  async function readSnapshot() {
    // 파일이 없을 때만 미수집 상태를 반환한다.
    let saved: Record<string, unknown>;
    try {
      saved = JSON.parse(await io.readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
    if (!saved || typeof saved !== 'object') throw new Error('수집 메타데이터 형식 오류');
    if (saved.formatVersion === undefined && Array.isArray(saved.rows)) {
      return { kind: 'legacy' as const, ...config.migrate(saved, saved.rows) };
    }
    if (saved.formatVersion !== 1 || !isListName(saved.listFile)) throw new Error('수집 메타데이터 형식 오류');
    return { kind: 'split' as const, metadata: config.readMetadata(saved), listFile: saved.listFile };
  }

  /**
   * 목록 참조를 읽지 않고 파일 정보로 검증한다.
   * @param listFile 메타데이터가 가리키는 파일명.
   * @throws 일반 목록 파일이 없거나 내용이 비어 있는 경우.
   */
  async function inspectList(listFile: string): Promise<void> {
    const info = await io.lstat(join(dirname(path), listFile));
    if (!info.isFile() || info.size === 0) throw new Error('참조 목록 파일 오류');
  }

  /**
   * 메타데이터만 반환하고 참조 목록은 파일 정보로 검사한다.
   * @returns 갱신 기준과 집계 또는 미수집 상태.
   * @throws 형식이나 목록 참조가 잘못된 경우.
   */
  async function getMetadata(): Promise<M | undefined> {
    const snapshot = await readCurrent(false);
    return snapshot?.metadata;
  }

  /**
   * 적용된 목록의 행을 읽는다.
   * @returns 원본 순서의 목록 또는 미수집 상태.
   * @throws 적용된 목록이나 메타데이터에 오류가 있는 경우.
   */
  async function getRows(): Promise<R[] | undefined> {
    const snapshot = await readCurrent(true);
    return snapshot?.rows;
  }

  /**
   * 목록이 교체되어 사라진 경우 새 세대를 한 번만 확인한다.
   * @param includeRows 목록 본문까지 읽을지 여부.
   * @returns 요청한 적용 데이터 또는 미수집 상태.
   * @throws 같은 세대가 누락되었거나 두 번째 접근까지 실패한 경우.
   */
  async function readCurrent(includeRows: boolean): Promise<{ metadata: M; rows?: R[] } | undefined> {
    const snapshot = await readSnapshot();
    if (!snapshot || snapshot.kind === 'legacy') return snapshot;
    try {
      return await load(snapshot);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const latest = await readSnapshot();
      if (latest?.kind !== 'split' || latest.listFile === snapshot.listFile) throw error;
      return load(latest);
    }

    /**
     * 한 세대의 참조를 검증하고 필요한 데이터만 읽는다.
     * @param entry 현재 확인 중인 저장 세대.
     * @returns 검증한 메타데이터 및 요청한 경우 행 목록.
     */
    async function load(entry: StoredMetadata<M>) {
      await inspectList(entry.listFile);
      if (!includeRows) return { metadata: entry.metadata };
      const rows: unknown = JSON.parse(await io.readFile(join(dirname(path), entry.listFile), 'utf8'));
      if (!Array.isArray(rows)) throw new Error('수집 목록 형식 오류');
      return { metadata: entry.metadata, rows: config.readRows(rows, entry.metadata) };
    }
  }

  /**
   * 출력 하나를 잠그고 필요한 전환을 수행한 뒤 요청 작업을 실행한다.
   * @param run 잠금 아래에서 실행할 수집 함수.
   * @returns 수집 함수의 결과.
   * @throws 잠금, 저장본 검증 또는 교체에 실패한 경우.
   */
  async function withCollectionStore<T>(run: CollectionRunner<M, R, T>): Promise<T> {
    // 상위 경로의 별칭을 해소해 같은 출력에 같은 잠금을 적용한다.
    await io.mkdir(dirname(path), { recursive: true });
    const directory = await io.realpath(dirname(path));
    const target = join(directory, basename(path));
    const lockPath = target + '.lock';
    // 다른 실행이 자료를 변경하는 동안에는 조회도 시작하지 않는다.
    let lock;
    try {
      lock = await io.open(lockPath, 'wx');
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('같은 출력 경로에 수집 잠금이 있습니다: ' + lockPath);
      throw error;
    }
    // 현재 적용된 파일명만 미참조 파일 정리에서 제외한다.
    let current: StoredMetadata<M> | undefined;
    try {
      // 읽기 전용 조회와 같은 형식 검증을 사용하고 전환은 수집 중에만 수행한다.
      const saved = await readSnapshot();
      if (saved?.kind === 'legacy') {
        await save(saved.metadata, saved.rows);
      } else if (saved) {
        await inspectList(saved.listFile);
        current = saved;
      }
      // 이전 실행에서 정리하지 못한 세대 파일을 다시 확인한다.
      if (current) await cleanup();
      return await run(current?.metadata, save);
    } finally {
      // 성공과 실패 모두에 대해 다음 실행에 잠금을 넘긴다.
      try {
        await lock.close();
      } finally {
        await io.unlink(lockPath);
      }
    }

    /**
     * 적용 중인 목록을 제외한 이 출력의 세대 파일을 정리한다.
     */
    async function cleanup() {
      try {
        // 다른 출력과 레거시 파일은 정리 대상에서 제외한다.
        for (const name of await io.readdir(directory)) {
          if (isListName(name) && name !== current.listFile) await remove(name);
        }
      } catch (error) {
        // 이미 적용된 갱신을 정리 오류 때문에 실패로 보고하지 않는다.
        console.warn('이전 목록 정리 지연: ' + error.message);
      }
    }

    /**
     * 이 실행이 정리할 파일만 지우고 실패는 다음 실행으로 넘긴다.
     * @param {string} name 같은 디렉터리에서 정리할 파일명.
     */
    async function remove(name: string) {
      try {
        await io.rm(join(directory, name), { force: true });
      } catch (error) {
        console.warn('수집 파일 정리 지연: ' + error.message);
      }
    }

    /**
     * 목록이 있으면 새 세대를 쓴 뒤 메타데이터를 적용한다.
     * @param {object} metadata 이번에 적용할 비교 기준과 건수.
     * @param {Array} [rows] 새 목록이며 생략하면 기존 목록을 참조한다.
     * @throws 목록이나 메타데이터를 저장하지 못했을 때.
     */
    async function save(metadata: M, rows?: R[]) {
      // 새로 계산한 기준과 집계도 재실행에서 읽을 수 있는 형식이어야 한다.
      config.readMetadata(metadata);
      // 새 목록은 기존 파일과 충돌하지 않는 이름으로 먼저 완성한다.
      const listFile = rows ? prefix + randomUUID() + '.json' : current?.listFile;
      if (!listFile) throw new Error('저장할 목록 참조 누락');
      const next: StoredMetadata<M> = { kind: 'split', metadata, listFile };
      const temp = basename(target) + '.' + randomUUID() + '.tmp';
      let applied = false;
      try {
        if (rows) await io.writeFile(join(directory, listFile), JSON.stringify(rows, null, 2) + '\n', { flag: 'wx', flush: true });
        await io.writeFile(join(directory, temp), JSON.stringify({ ...metadata, formatVersion: 1, listFile }, null, 2) + '\n', { flag: 'wx', flush: true });
        // 같은 디렉터리의 이름 교체가 새 목록의 적용 시점이다.
        await rename(join(directory, temp), target);
        applied = true;
        current = next;
      } finally {
        if (!applied) {
          await remove(temp);
          if (rows) await remove(listFile);
        }
      }
      // 날짜만 바뀐 실행에서는 목록 디렉터리를 다시 순회하지 않는다.
      if (rows) await cleanup();
    }
  }
}

// CLI의 스냅샷 파일과 잠금에 사용하는 로컬 파일 작업이다.
const fs = require('node:fs/promises');
const { basename, dirname, join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');

/**
 * 출력 하나를 잠그고 메타데이터 조회, 전환 및 교체를 제공한다.
 * @param {object} options 출력 경로, 형식 검증 및 파일 작업 설정.
 * @param {Function} run 잠금 아래에서 실행할 수집 함수.
 * @returns {Promise<*>} 수집 함수의 결과.
 * @throws 잠금, 저장본 검증 또는 교체에 실패한 경우.
 */
async function withCollectionStore({ output, validate, migrate, io = fs, rename = io.rename }, run) {
  // 상위 경로의 별칭을 해소해 같은 출력에 같은 잠금을 적용한다.
  const path = resolve(output);
  await io.mkdir(dirname(path), { recursive: true });
  const directory = await io.realpath(dirname(path));
  const target = join(directory, basename(path));
  const prefix = basename(target) + '.rows-';
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
  let current;
  try {
    // 기존 저장본은 메타데이터 또는 최초 전환 대상이다.
    let saved;
    try {
      saved = JSON.parse(await io.readFile(target, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (saved !== undefined) {
      if (saved?.formatVersion === undefined && Array.isArray(saved?.rows)) {
        // 기존 파일은 메타데이터 교체가 완료되기 전까지 유지한다.
        await save(migrate(saved), saved.rows);
      } else {
        if (saved?.formatVersion !== 1 || !isListName(saved.listFile) || !validate(saved)) {
          throw new Error('수집 메타데이터 형식 오류');
        }
        // 목록을 열지 않고 파일 정보로 유효한 참조인지 확인한다.
        const info = await io.lstat(join(directory, saved.listFile));
        if (!info.isFile() || info.size === 0) throw new Error('참조 목록 파일 오류');
        current = saved;
      }
    }
    // 이전 실행에서 정리하지 못한 세대 파일을 다시 확인한다.
    if (current) await cleanup();
    return await run(current, save);
  } finally {
    // 성공과 실패 모두에 대해 다음 실행에 잠금을 넘긴다.
    try {
      await lock.close();
    } finally {
      await io.unlink(lockPath);
    }
  }

  /**
   * 이 출력에 속하는 세대 파일명인지 검사한다.
   * @param {unknown} name 검증할 메타데이터 참조 또는 디렉터리 항목명.
   * @returns {boolean} 같은 출력이 생성하는 목록 파일명인지 여부.
   */
  function isListName(name) {
    return typeof name === 'string' && name.startsWith(prefix) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(name.slice(prefix.length));
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
  async function remove(name) {
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
  async function save(metadata, rows) {
    // 새로 계산한 기준과 집계도 재실행에서 읽을 수 있는 형식이어야 한다.
    if (!validate(metadata)) throw new Error('저장할 수집 메타데이터 형식 오류');
    // 새 목록은 기존 파일과 충돌하지 않는 이름으로 먼저 완성한다.
    const listFile = rows ? prefix + randomUUID() + '.json' : current.listFile;
    const next = { ...metadata, formatVersion: 1, listFile };
    const temp = basename(target) + '.' + randomUUID() + '.tmp';
    let applied = false;
    try {
      if (rows) await io.writeFile(join(directory, listFile), JSON.stringify(rows, null, 2) + '\n', { flag: 'wx', flush: true });
      await io.writeFile(join(directory, temp), JSON.stringify(next, null, 2) + '\n', { flag: 'wx', flush: true });
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

// 두 CLI에서 같은 저장 계약을 사용한다.
module.exports = { withCollectionStore };

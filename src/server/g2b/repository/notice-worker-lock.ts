import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** 별도 파일에 SQLite 쓰기 잠금을 잡아 동일 데이터 디렉터리의 워커를 하나로 제한한다. */
export function acquireNoticeWorkerLock(directory = join(process.cwd(), ".data")) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "notice-worker.sqlite"));
  try {
    db.exec("BEGIN EXCLUSIVE");
    return () => db.close();
  } catch (error) {
    db.close();
    throw error;
  }
}

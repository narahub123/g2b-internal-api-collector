import { openG2bRepository } from "./sqlite";
import type { G2bRepository } from "./types";

let repository: G2bRepository | undefined;

/**
 * 프로세스에서 공유하는 나라장터 저장소를 반환한다.
 * 처음 호출할 때 SQLite 연결을 열고 업무별 테이블을 준비한다.
 * @throws SQLite 연결 또는 스키마 초기화에 실패한 경우.
 */
export function getG2bRepository() {
  return repository ??= openG2bRepository();
}

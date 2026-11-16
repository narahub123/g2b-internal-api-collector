import { G2bDatabase } from "./database";
import { openG2bRepository } from "./turso";
import { createTursoClient } from "./turso-client";

let database: G2bDatabase | undefined;
let repository: ReturnType<typeof openG2bRepository> | undefined;

/** 프로세스 안의 웹 요청 또는 워커 작업이 하나의 원격 연결을 공유하게 한다. */
export function getG2bDatabase() {
  return database ??= new G2bDatabase(createTursoClient());
}

/** 스키마가 적용된 원격 DB에 연결된 저장소를 반환한다. */
export function getG2bRepository() {
  return repository ??= openG2bRepository(getG2bDatabase());
}

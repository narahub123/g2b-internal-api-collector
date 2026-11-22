import { AsyncLocalStorage } from "node:async_hooks";
import type { Client, InStatement, InValue, Transaction, Value } from "@libsql/client";

export type SQLInputValue = InValue;

// 외부 요청으로 이어지는 비동기 호출에도 실행권 검증을 적용한다.
const workerToken = new AsyncLocalStorage<string>();

/** 워커가 시작한 작업의 저장과 큐 갱신에 사용할 실행권 토큰을 전달한다. */
export function withNoticeWorkerToken<T>(token: string, run: () => Promise<T>): Promise<T> {
  return workerToken.run(token, run);
}

/** 실행권이 교체되면 워커의 이전 쓰기를 중단시키는 저장소 오류. */
export class NoticeWorkerLeaseLostError extends Error {
  /** 실행권 상실과 일시적인 연결 오류를 호출자가 구분할 수 있게 한다. */
  constructor() {
    super("공고 수집 워커 실행권이 만료되었거나 변경되었습니다.");
  }
}

/**
 * SQL 바인딩과 트랜잭션을 저장소에 제공한다.
 * 트랜잭션 안의 모든 저장소 조회가 동일한 libSQL 트랜잭션을 사용한다.
 */
export class G2bDatabase {
  private localOperations = Promise.resolve();
  private readonly scope = new AsyncLocalStorage<Transaction>();

  /** 클라이언트의 연결 수명을 소유한 호출자와 같은 연결을 사용한다. */
  constructor(readonly client: Client) {}

  // 파일·메모리 클라이언트의 단일 연결은 열린 트랜잭션과 같은 연결의 독립 호출을 허용하지 않는다.
  private schedule<T>(run: () => Promise<T>): Promise<T> {
    if (this.client.protocol !== "file") return run();
    const result = this.localOperations.then(run);
    this.localOperations = result.then(() => {}, () => {});
    return result;
  }

  /**
   * 이미 열린 트랜잭션 안에서는 같은 연결에서 실행하고, 파일 DB의 독립 쿼리는 순서대로 처리한다.
   * @throws 연결 또는 SQL 실행에 실패하면 저장소 오류를 전달한다.
   * @param statement SQL과 바인딩할 값을 담은 libSQL 실행 입력.
   * @returns 쿼리 결과 행 또는 처리한 변경 내역.
   */
  execute(statement: InStatement) {
    // 현재 비동기 작업이 열어 둔 트랜잭션을 조회한다.
    const transaction = this.scope.getStore();
    // 트랜잭션이 있으면 같은 연결을 사용하고 독립 실행은 파일 DB 직렬화에 맡긴다.
    return transaction
      ? transaction.execute(statement)
      : this.schedule(() => this.client.execute(statement));
  }

  /**
   * 바인딩된 쿼리를 실행한다. 워커의 쓰기는 실행권을 검사한 트랜잭션에서 처리한다.
   * @param sql 인자를 바인딩해 실행할 SQL 문장.
   * @returns 첫 행 조회, 전체 행 조회, 실행 결과를 제공하는 함수 모음.
   */
  prepare(sql: string) {
    /**
     * 준비된 SQL에 인자를 묶어 공통 실행기로 전달한다.
     * @param args SQL 자리표시자의 순서에 맞춘 값.
     * @returns 실행한 SQL의 결과 또는 실행 실패를 나타내는 거부된 Promise.
     */
    const execute = (args: InValue[]) => this.execute({ sql, args });
    // 동일 SQL의 실행 결과를 호출자가 필요한 형태로 읽을 수 있게 한다.
    return {
      /**
       * 조회 결과의 첫 행을 반환하며 일치하는 행이 없으면 undefined를 반환한다.
       * @param args SQL 자리표시자에 바인딩할 값.
       * @returns 조회 첫 행 또는 행이 없으면 undefined.
       * @throws 연결 또는 SQL 실행에 실패한 경우.
       */
      get: async (...args: InValue[]): Promise<Record<string, Value> | undefined> => (await execute(args)).rows[0],
      /**
       * 바인딩 조건에 맞는 모든 조회 행을 반환한다.
       * @param args SQL 자리표시자에 바인딩할 값.
       * @returns 바인딩 조건에 따라 조회한 전체 행.
       * @throws 연결 또는 SQL 실행에 실패한 경우.
       */
      all: async (...args: InValue[]): Promise<Record<string, Value>[]> => (await execute(args)).rows,
      /**
       * 변경 결과와 새 행 ID를 반환한다. 실행권이 만료된 워커의 쓰기는 거부한다.
       * @param args SQL 자리표시자에 바인딩할 값.
       * @returns SQL 변경 결과와 새 행 ID를 포함한 실행 결과.
       * @throws SQL 실행 또는 워커의 실행권 확인에 실패한 경우.
       */
      run: (...args: InValue[]) => this.scope.getStore() || !workerToken.getStore()
        ? execute(args)
        : this.transaction(() => execute(args)),
    };
  }

  /**
   * 쓰기 작업을 직렬화하고 공고 워커의 실행권을 같은 트랜잭션에서 확인한다.
   * @throws 실행권이 만료되었거나 DB 처리에 실패하면 변경을 폐기하고 오류를 전달한다.
   */
  transaction<T>(run: () => Promise<T>, write = true): Promise<T> {
    if (this.scope.getStore()) return run();
    return this.schedule(() => this.runTransaction(run, write));
  }

  private async runTransaction<T>(run: () => Promise<T>, write: boolean): Promise<T> {
    const transaction = await this.client.transaction(write ? "write" : "read");
    try {
      const token = write && workerToken.getStore();
      if (token) {
        const { rows } = await transaction.execute({
          sql: "SELECT 1 FROM g2b_notice_worker_lease WHERE id = 1 AND token = ? AND expires_at > unixepoch()",
          args: [token],
        });
        if (!rows.length) throw new NoticeWorkerLeaseLostError();
      }
      const result = await this.scope.run(transaction, run);
      await transaction.commit();
      return result;
    } finally {
      transaction.close();
    }
  }
}

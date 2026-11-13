import type { CollectNoticeInput } from "@/features/collect-g2b/model/input";
import type { CollectionDiagnostic } from "@/shared/api/g2b/collection-diagnostic";

export type NoticeAttemptCompletion = {
  id: number;
  status: "succeeded" | "failed" | "deferred";
  finishedAt: string;
  error: string | null;
  diagnostics?: CollectionDiagnostic;
};

export type NoticeQueueInput = CollectNoticeInput & { opening?: boolean };
export type NoticeJobStatus = "pending" | "running" | "retry_wait" | "succeeded" | "failed";

export type NoticeJobResult = {
  noticeSaved?: boolean;
  targetRevisions?: string[];
  succeededRevisions?: string[];
  failedRevisions?: string[];
};

export type NoticeJob = {
  id: number;
  input: NoticeQueueInput;
  force: boolean;
  status: NoticeJobStatus;
  failures: number;
  executions: number;
  availableAt: number;
  error: string | null;
  result: NoticeJobResult | null;
};

export type NoticeJobOutcome =
  | { kind: "success"; related: NoticeQueueInput[]; result: NoticeJobResult }
  | { kind: "failure"; error: string; result?: NoticeJobResult; related?: NoticeQueueInput[] }
  | { kind: "internal_error"; error: string }
  | { kind: "maintenance"; error: string; result?: NoticeJobResult };

export interface NoticeQueue {
  /** 최초 탐색과 작업을 함께 등록하고 대상별 작업 ID를 반환한다. */
  enqueue(inputs: NoticeQueueInput[], force: boolean, retryAttemptId?: number): number[];
  /** 중단 사유가 없을 때 다음 작업을 선점한다. */
  claim(now: number): NoticeJob | undefined;
  /** 실행 결과와 후속 탐색 작업을 한 트랜잭션에 반영한다. */
  finish(id: number, outcome: NoticeJobOutcome, now: number, attempts?: readonly NoticeAttemptCompletion[]): void;
  /** 독점 워커 실행권 획득 후 미완료 작업과 시도를 정리한다. */
  recover(): void;
  /** 영속 작업 상태와 결과를 조회한다. */
  get(id: number): NoticeJob | undefined;
  /** 운영 화면에 표시할 활성 작업과 최근 작업을 조회한다. */
  overview(): { manual: boolean; maintenance: number; active: number | null; jobs: NoticeJob[] };
  /** 현재 점검 세대를 읽어 확인 도중 들어온 새 점검과 구분한다. */
  maintenanceVersion(): number;
  /** 수동 중단 요청 상태를 저장한다. */
  setManual(paused: boolean): void;
  /** 점검을 기록하고 이전 정상 확인의 효력을 무효화한다. */
  markMaintenance(): void;
  /** 같은 세대가 유지된 경우에만 점검 사유를 해제한다. */
  clearMaintenance(version: number): void;
}

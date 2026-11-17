import type { CollectNoticeInput } from "@/features/collect-g2b/model/input";
import type { CollectionDiagnostic } from "@/shared/api/g2b/collection-diagnostic";
import type { openNoticeAutomatic } from "./notice-automatic";

/** 실패 시각부터 다음 공고 재시도까지의 간격. 단발 워커의 대기 범위에도 사용한다. */
export const noticeRetryDelayMs = 60_000;

export type NoticeAttemptCompletion = {
  id: number;
  status: "succeeded" | "failed" | "deferred";
  finishedAt: string;
  error: string | null;
  diagnostics?: CollectionDiagnostic;
};

export type NoticeQueueInput = CollectNoticeInput & { opening?: boolean; title?: string };
export type NoticeJobStatus = "pending" | "running" | "retry_wait" | "succeeded" | "failed";
/** 수동 요청은 강제 재수집 여부와 관계없이 자동 수집보다 먼저 처리한다. */
export type NoticeSource = "manual" | "automatic";

export type NoticeJobResult = {
  title?: string;
  noticeSaved?: boolean;
  targetRevisions?: string[];
  succeededRevisions?: string[];
  failedRevisions?: string[];
};

/** 한국 현지 시각의 분 단위 조회 범위. */
export type NoticeRunPeriod = { startMinute: string; endMinute: string };

export type NoticeRunOutcome =
  | { kind: "targets"; targets: (CollectNoticeInput & { title: string })[] }
  | { kind: "failure" | "maintenance"; error: string };

export type NoticeRunSummary = NoticeRunPeriod & {
  id: number;
  status: "pending" | "discovering" | "collecting" | "completed" | "failed";
  pauseReason: "manual" | "maintenance" | "automatic" | null;
  initialCount: number | null;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  error: string | null;
};
export type NoticeRun = NoticeRunSummary & {
  notices: (CollectNoticeInput & { title: string; status: NoticeJobStatus; error: string | null })[];
};
export type NoticeRunCursor = { direction: "before" | "after"; visitId: number };
export type NoticeRunNoticePage = {
  items: (NoticeRun["notices"][number] & { id: number })[];
  previous: NoticeRunCursor | null;
  next: NoticeRunCursor | null;
  resetCursor: boolean;
};
export type NumberedNoticePage = Pick<NoticeRunNoticePage, "items"> & {
  page: number;
  totalPages: number;
};
export type NoticeCollectionCounts = { total: number; pending: number; running: number; completed: number; failed: number };
export type NoticeQueueSummary = {
  manual: boolean;
  maintenance: number;
  counts: NoticeCollectionCounts;
  currentJob: NoticeJob | null;
  totalPages: number;
  failedTotalPages: number;
};
export type NoticeQueueListKind = "all" | "failed";
export type NoticeQueuePageData = { page: number; totalPages: number; jobs: NoticeJob[] };

export type NoticeJob = {
  id: number;
  input: NoticeQueueInput;
  source: NoticeSource;
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
  /** 자동 수집의 관리자 설정과 정기 회차 접수를 관리한다. */
  automatic: ReturnType<typeof openNoticeAutomatic>;
  /** 실행 가능한 작업이 있고 활성 워커가 없을 때 Actions 호출을 예약한다. */
  reserveWorkerDispatch(now: number): Promise<string | undefined>;
  /** 실패한 호출의 예약을 해제한다. 실행권을 획득한 워커는 토큰을 생략해 예약을 인수한다. */
  releaseWorkerDispatch(token?: string): Promise<void>;
  /** 보류 사유를 제외한 작업 중 다음 재시도 가능 시각을 조회한다. */
  nextRetryAt(): Promise<number | null>;
  /** 기간 탐색을 영속 접수한다. 같은 요청 키·기간·출처는 기존 실행 ID를 반환한다. */
  enqueueRun(period: NoticeRunPeriod, requestKey?: string, source?: NoticeSource): Promise<number>;
  /** 중단 사유가 없을 때 지정한 출처의 탐색을 선점한다. 생략하면 수동 탐색을 우선한다. */
  claimRun(source?: NoticeSource): Promise<(NoticeRunPeriod & { id: number }) | undefined>;
  /** 목록과 최초 상세 결과가 모두 저장된 자동 구간의 가장 늦은 종료 시각을 반환한다. */
  getAutomaticCoveredThrough(): Promise<string | null>;
  /** 목록 결과와 초기 공고 작업을 한 트랜잭션으로 반영한다. */
  finishRun(id: number, outcome: NoticeRunOutcome, now?: number): Promise<void>;
  /** 실행과 소속 공고를 같은 읽기 시점에서 반환한다. ID 생략 시 최근 실행을 조회한다. */
  getRun(id?: number): Promise<NoticeRun | undefined>;
  /** 저장된 집계와 실행 상태를 조회한다. ID 생략 시 최근 기간 실행을 복원한다. */
  getRunSummary(id?: number): Promise<NoticeRunSummary | undefined>;
  /** 기간 실행의 방문 순서로 최대 20건을 반환하며 실패 목록은 최종 실패만 포함한다. */
  listRunNotices(id: number, kind: "all" | "failed", cursor?: NoticeRunCursor): Promise<NoticeRunNoticePage | undefined>;
  /** 기간 실행의 저장된 집계로 페이지를 보정하고, 등록 순서대로 공고를 조회한다. */
  numberRunNotices(id: number, kind: "all" | "failed", page: number): Promise<NumberedNoticePage | undefined>;
  /** 저장된 상세가 없는 공고의 최근 기간 수집 결과를 조회한다. */
  findRunNotice(number: string, revision: string): Promise<NoticeRun["notices"][number] | undefined>;
  /** 자동 수집이 꺼져 있을 때 점검 종료 확인이 필요한 수동 대기 작업이 있는지 조회한다. */
  needsManualMaintenanceCheck(): Promise<boolean>;
  /** 최초 탐색과 작업을 함께 등록하고 대상별 작업 ID를 반환한다. */
  enqueue(inputs: NoticeQueueInput[], force: boolean, retryAttemptId?: number): Promise<number[]>;
  /** 실행 가능한 작업을 수동·재시도·일반 자동 순으로 선점한다. 우선순위를 지정하면 해당 작업만 선택한다. */
  claim(now: number, priority?: "manual" | "retry"): Promise<NoticeJob | undefined>;
  /** 상세 우선순위와 기간 탐색을 한 트랜잭션에서 비교한 뒤 다음 작업을 선점한다. */
  claimNext(now: number, preferRun: boolean): Promise<
    { kind: "job"; job: NoticeJob } | { kind: "run"; run: NoticeRunPeriod & { id: number } } | undefined
  >;
  /** 실행 결과와 후속 탐색 작업을 한 트랜잭션에 반영한다. */
  finish(id: number, outcome: NoticeJobOutcome, now: number, attempts?: readonly NoticeAttemptCompletion[]): Promise<void>;
  /** 독점 워커 실행권 획득 후 미완료 작업과 시도를 정리한다. */
  recover(): Promise<void>;
  /** 영속 작업 상태와 결과를 조회한다. */
  get(id: number): Promise<NoticeJob | undefined>;
  /** 운영 화면에 표시할 활성 작업과 최근 작업을 조회한다. */
  overview(): Promise<{ manual: boolean; maintenance: number; active: number | null; jobs: NoticeJob[] }>;
  /** 저장된 큐 집계와 현재 상세 수집 작업을 같은 시점에서 반환한다. */
  getQueueSummary(): Promise<NoticeQueueSummary>;
  /** 최신 ID 순으로 최대 20건을 반환한다. 기본 목록은 진행 중인 작업을 제외하고 실패 목록은 최종 실패만 포함한다. */
  getQueuePage(page: number, kind?: NoticeQueueListKind): Promise<NoticeQueuePageData>;
  /** 현재 점검 세대를 읽어 확인 도중 들어온 새 점검과 구분한다. */
  maintenanceVersion(): Promise<number>;
  /** 수동 중단 요청 상태를 저장한다. */
  setManual(paused: boolean): Promise<void>;
  /** 점검을 기록하고 이전 정상 확인의 효력을 무효화한다. */
  markMaintenance(): Promise<void>;
  /** 점검 세대와 확인이 허용된 일정 세대가 유지된 경우에만 점검 사유를 해제한다. */
  clearMaintenance(version: number, scheduleGeneration?: number): Promise<void>;
}

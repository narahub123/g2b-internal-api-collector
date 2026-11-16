import type { ContractRequest, ContractRequestKey } from '@/entities/contract-request/model/contract-request';
import type { Contract, ContractKey } from '@/entities/contract/model/contract';
import type { OpeningResult, OpeningResultKey } from '@/entities/opening-result/model/opening-result';
import type { OrderPlan } from '@/entities/order-plan/model/order-plan';
import type { PriorSpec } from '@/entities/prior-spec/model/prior-spec';
import type { Notice, NoticeKey, NoticeSummary } from '@/entities/notice/model/types';
import type { openCollectionAttempts } from './collection-attempts';

// 대시보드에 집계하는 여섯 업무의 저장 행 수이며, 키는 공용 업무 경로와 일치한다.
export type G2bCollectionCounts = {
  'order-plans': number;
  'prior-specs': number;
  notices: number;
  'contract-requests': number;
  'opening-results': number;
  contracts: number;
};

export interface G2bRepository {
  collectionDeletion: ReturnType<typeof import("./collection-deletion").openCollectionDeletion>;
  noticeQueue: import("./notice-queue-types").NoticeQueue;
  collectionAttempts: ReturnType<typeof openCollectionAttempts>;
  /**
   * 여섯 업무의 저장 행 수를 같은 시점 기준으로 조회한다.
   * @returns 차수가 다른 행은 각각 집계하며, 빈 테이블의 건수는 0이다.
   * @throws 저장소에서 집계 쿼리를 실행하지 못한 경우.
   */
  getCollectionCounts(): Promise<G2bCollectionCounts>;
  list(): Promise<NoticeSummary[]>;
  find(key: NoticeKey): Promise<Notice | null>;
  /**
   * 재사용할 수 있는 저장 상세를 읽고 업무별 상세 번호와 차수를 확인한다.
   * @returns 키가 일치하는 저장 공고. 행이 없거나 상세를 읽을 수 없으면 null.
   * @throws SQLite 조회에 실패한 경우.
   */
  findUsableNotice(key: NoticeKey): Promise<Notice | null>;
  save(notice: Notice): Promise<void>;
  /**
   * 발주계획을 번호로 조회한다.
   * @param number 조회할 발주계획번호.
   * @returns 저장된 계획 또는 null.
   */
  findOrderPlan(number: string): Promise<OrderPlan | null>;
  /**
   * 발주계획을 최초 한 번 저장한다. 같은 번호가 있으면 기존 자료를 유지한다.
   * @param plan 수집한 발주계획과 원본 응답.
   */
  saveOrderPlan(plan: OrderPlan): Promise<void>;
  /**
   * 최초 수집한 첨부 목록을 계획 원본에 추가한다.
   * @param number 이미 저장된 발주계획번호.
   * @param collectedAt 첨부 그룹을 확인한 발주계획 본문의 수집 시각.
   * @param attachments 첨부 목록 API 원본 응답.
   */
  saveOrderPlanAttachments(number: string, collectedAt: string, attachments: Record<string, unknown>): Promise<void>;
  /**
   * 발주계획을 참조하는 로컬 공고를 조회한다.
   * @param number 발주계획번호.
   * @returns 공고번호와 차수 목록.
   */
  findNoticesForOrderPlan(number: string): Promise<NoticeKey[]>;
  /**
   * 저장된 발주계획을 재수집 결과로 교체한다.
   * @param plan 새 상세와 첨부 목록.
   */
  replaceOrderPlan(plan: OrderPlan): Promise<void>;
  /**
   * 번호에 해당하는 저장된 사전규격을 조회한다.
   * @param number 사전규격등록번호.
   * @returns 저장된 사전규격 또는 null.
   */
  findPriorSpec(number: string): Promise<PriorSpec | null>;
  /**
   * 사전규격을 번호별로 저장하거나 갱신한다.
   * @param spec 저장할 사전규격과 첨부 목록.
   */
  savePriorSpec(spec: PriorSpec): Promise<void>;
  /**
   * 계약요청 상세와 품목을 조회한다.
   * @param key 계약요청접수번호와 차수.
   * @returns 저장된 계약요청 또는 null.
   */
  findContractRequest(key: ContractRequestKey): Promise<ContractRequest | null>;
  /**
   * 상세와 품목을 함께 저장하거나 갱신한다.
   * @param contractRequest 수집을 완료한 계약요청.
   */
  saveContractRequest(contractRequest: ContractRequest): Promise<void>;
  /**
   * 계약현황 상세를 복합 키로 조회한다.
   * @param key 계약번호와 변경차수.
   * @returns 저장된 계약 또는 null.
   */
  findContract(key: ContractKey): Promise<Contract | null>;
  /**
   * 계약현황 상세와 목록을 함께 저장하거나 갱신한다.
   * @param contract 검증을 완료한 계약 상세와 세 목록.
   */
  saveContract(contract: Contract): Promise<void>;
  /**
   * 개찰결과를 복합 키로 조회한다.
   * @param key 공고번호, 공고차수, 개찰차수.
   * @returns 저장된 개찰결과 또는 null.
   */
  findOpeningResult(key: OpeningResultKey): Promise<OpeningResult | null>;
  /**
   * 공고의 개찰결과를 개찰차수 순서로 조회한다.
   * @param key 공고번호와 공고차수.
   * @returns 저장된 개찰결과 목록.
   */
  listOpeningResults(key: NoticeKey): Promise<OpeningResult[]>;
  /**
   * 개찰차수의 유찰 상세를 함께 저장하거나 갱신한다.
   * @param result 해당 차수에서 수집한 결과와 조회 조건.
   */
  saveOpeningResult(result: OpeningResult): Promise<void>;
}

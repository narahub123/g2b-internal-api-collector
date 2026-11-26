import { contractRevision } from "@/entities/contract/model/contract";
import { formatValue } from "@/entities/contract-request/model/contract-request-display";
import { isMockNotice } from "@/entities/notice/model/notice-detail";
import { COLLECTION_LIST_PAGE_SIZE } from "@/shared/config/collection-list";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { isInterestType, type InterestItem, type InterestKey, type InterestType } from "@/shared/model/g2b/interest";
import type { G2bDatabase } from "./database";
import { openG2bRepository } from "./turso";

/** 업무 키의 세 부분을 같은 순서로 비교해 조회·삭제·중복 판단에 사용한다. */
const keyCondition = "business_type = ? AND business_number = ? AND business_revision = ?";

/**
 * 상세 URL과 같은 정규화 규칙으로 외부 입력에 담긴 업무 키를 검사한다.
 * @param input 사용자 요청에 담긴 업무 식별자.
 * @returns 정규화된 입력이면 업무 키, 아니면 undefined.
 */
export function parseInterestKey(input: unknown): InterestKey | undefined {
  // 객체를 확인한 뒤 사용자 입력의 세 필드만 읽는다.
  if (!input || typeof input !== "object") return;
  const { type, number, revision } = input as Partial<InterestKey>;
  // 경로와 다른 표기의 번호나 지원하지 않는 업무를 차단한다.
  if (!isInterestType(type) || typeof number !== "string" || g2bNumber(number) !== number ||
    typeof revision !== "string") return;
  // 차수가 없는 업무와 계약변경차수의 예외를 기존 상세 규칙에 맞춘다.
  const validRevision = type === "order-plans" || type === "prior-specs"
    ? revision === ""
    : type === "contracts" ? contractRevision(revision) === revision : /^\d{3}$/.test(revision);
  // 유효한 상세에만 사용할 수 있는 키를 돌려준다.
  if (validRevision) return { type, number, revision };
}

/**
 * 화면 제목으로 표시할 나라장터 텍스트를 선택한다.
 * @param value 원본 제목 후보.
 * @param fallback 원본에 제목이 없는 업무의 상세 화면 제목.
 * @returns 비어 있지 않은 제목.
 */
function titleOrFallback(value: unknown, fallback: string) {
  // 숫자로 저장된 제목도 기존 화면처럼 문자열로 읽고 공백만 있으면 기본 제목을 사용한다.
  const title = typeof value === "string" || typeof value === "number" ? String(value) : "";
  // 제목의 원문은 보존하고 표시할 때 엔티티를 처리한다.
  return title.trim() ? title : fallback;
}

/**
 * 사용자 관심 상태와 화면용 목록을 동일 DB에서 관리하는 저장소를 연다.
 * @param db 인증·원본·관심 데이터를 공유하는 DB 연결.
 * @returns 상태 확인, 등록, 일괄 제거 및 목록 조회 함수.
 */
export function openInterests(db: G2bDatabase) {
  // 기본 키로 사용자의 단일 관심 상태를 확인한다.
  const exists = db.prepare(`SELECT EXISTS (SELECT 1 FROM g2b_interests WHERE user_id = ? AND ${keyCondition}) AS subscribed`);
  // 같은 키로 중복 요청이 도착하면 첫 등록의 제목과 등록일시를 보존한다.
  const insert = db.prepare(`INSERT INTO g2b_interests VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, business_type, business_number, business_revision) DO NOTHING`);

  /**
   * 동일 트랜잭션의 원본에서 사용자 상세가 표시하는 제목을 구한다.
   * @param key 등록할 업무의 상세 키.
   * @returns 등록할 수 있는 원본의 제목 또는 대상이 없거나 제외되는 경우 undefined.
   * @throws 원본 조회나 저장 데이터 읽기에 실패한 경우.
   */
  async function sourceTitle(key: InterestKey) {
    // 등록에서만 원본 저장소를 열고 등록 트랜잭션과 같은 연결을 사용한다.
    const source = openG2bRepository(db);
    // 업무마다 다른 원본 형태에서 상세 제목을 선택한다.
    switch (key.type) {
      case "order-plans": {
        // 차수 없이 조회한 발주계획에서 사업명과 품명 순으로 제목을 선택한다.
        const plan = await source.findOrderPlan(key.number);
        if (!plan) return;
        const { bizNm, itemNm } = plan.payload.dlOderPlanM;
        const title = [bizNm, itemNm].find((value) => typeof value === "string" && value.trim());
        return titleOrFallback(title, "발주계획 상세");
      }
      case "prior-specs": {
        // 차수 없이 조회한 사전규격의 규격명을 사용한다.
        const spec = await source.findPriorSpec(key.number);
        return spec ? titleOrFallback(spec.payload.dlBfSpecM.bfSpecNm, "사전규격 상세") : undefined;
      }
      case "contract-requests": {
        // 계약요청 상세의 값 표시 규칙을 적용해 사업명을 사용한다.
        const request = await source.findContractRequest(key);
        return request ? formatValue(request.detail.bizNm) ?? "계약요청 상세" : undefined;
      }
      case "contracts": {
        // 변경차수로 조회한 계약 원본의 계약명을 사용한다.
        const contract = await source.findContract(key);
        return contract ? titleOrFallback(contract.detail.ctrtNm, "계약현황") : undefined;
      }
      case "notices": {
        // 모의공고와 미수집 공고는 회원용 상세 주소의 등록 대상에서 제외한다.
        const notice = await source.find(key);
        return notice && !isMockNotice(notice) ? titleOrFallback(notice.title, "입찰공고 상세") : undefined;
      }
      case "opening-results": {
        // 개찰진행차수 중 하나라도 존재해야 공고번호·공고차수로 상세를 열 수 있다.
        if (!(await source.listOpeningResults(key)).length) return;
        // 개찰 상세는 연결 공고의 제목을 우선 사용한다.
        const notice = await source.find(key);
        return titleOrFallback(notice?.title, "개찰결과 상세");
      }
    }
  }

  // 상태, 변경 및 화면에 필요한 최소 조회만 호출자에게 제공한다.
  return {
    /**
     * 사용자와 업무의 전체 키로 현재 관심 여부를 확인한다.
     * @param userId 인증으로 확인한 내부 사용자 ID.
     * @param key 현재 상세를 식별하는 업무 키.
     * @returns 관심 행이 존재하는지 여부.
     * @throws 관심 테이블 조회에 실패한 경우.
     */
    async has(userId: string, key: InterestKey) {
      // 동일 키의 행이 존재하는지만 읽어 초기 별 상태로 반환한다.
      const row = await exists.get(userId, key.type, key.number, key.revision);
      return Number(row?.subscribed) === 1;
    },

    /**
     * 삭제 트리거와 경합해도 원본 없는 관심 항목이 남지 않도록 등록한다.
     * @param userId 인증으로 확인한 내부 사용자 ID.
     * @param key 검증을 마친 상세 키.
     * @returns 등록 상태면 true, 원본이 없거나 제외 대상이면 false.
     * @throws 조회나 저장이 실패하면 트랜잭션에서 변경을 폐기하고 오류를 전달한다.
     */
    async add(userId: string, key: InterestKey) {
      // 원본 확인과 관심 등록 사이에 다른 쓰기가 원본을 삭제하지 못하도록 한다.
      return db.transaction(async () => {
        // 대상 확인을 마친 시점의 제목을 등록에 사용한다.
        const title = await sourceTitle(key);
        // 원본이 없으면 쓰기 없이 실패를 돌려준다.
        if (title === undefined) return false;
        // 기존 행은 보존하고 새 대상에만 현재 등록일시를 기록한다.
        await insert.run(userId, key.type, key.number, key.revision, title, new Date().toISOString());
        // 재시도에서도 최종 등록 상태를 반환한다.
        return true;
      });
    },

    /**
     * 선택한 사용자 관심 행만 같은 트랜잭션에서 제거한다.
     * @param userId 인증으로 확인한 내부 사용자 ID.
     * @param keys 개별 또는 일괄 삭제에서 검증한 업무 키.
     * @returns 실제 삭제된 관심 행 수.
     * @throws 일부 삭제라도 실패하면 전체 변경을 폐기하고 오류를 전달한다.
     */
    async remove(userId: string, keys: readonly InterestKey[]) {
      // 호출자가 선택을 비웠으면 DB 요청 없이 종료한다.
      if (!keys.length) return 0;
      // 사용자 ID를 포함한 복합 키를 바인딩해 각 선택 항목을 한 문장으로 삭제한다.
      const placeholders = keys.map(() => "(?, ?, ?, ?)").join(", ");
      const args = keys.flatMap(({ type, number, revision }) => [userId, type, number, revision]);
      // 단일 쓰기는 원자적으로 반영되며 중복 키나 이미 사라진 행은 변경 건수에 포함되지 않는다.
      const { rowsAffected } = await db.prepare(`DELETE FROM g2b_interests
        WHERE (user_id, business_type, business_number, business_revision) IN (VALUES ${placeholders})`).run(...args);
      // 확인 토스트에서 실제로 제거된 행의 수를 사용한다.
      return rowsAffected;
    },

    /**
     * 관심 테이블만 읽어 유형 필터와 최신순이 적용된 마이페이지 결과를 구성한다.
     * @param userId 인증으로 확인한 내부 사용자 ID.
     * @param type 선택한 업무 유형. 없으면 전체 목록이다.
     * @param requestedPage URL에서 유효성을 확인한 1부터 시작하는 페이지 번호.
     * @returns 관심 목록, 보정된 페이지와 전체 페이지 수.
     * @throws 읽기 트랜잭션 또는 쿼리가 실패한 경우.
     */
    async list(userId: string, type: InterestType | undefined, requestedPage: number) {
      // 사용자 범위는 항상 적용하고 유형이 선택되면 복합 인덱스의 유형 범위까지 좁힌다.
      const where = type ? "user_id = ? AND business_type = ?" : "user_id = ?";
      // 유형 입력을 SQL 본문과 분리해서 바인딩한다.
      const args = type ? [userId, type] : [userId];
      // 건수와 페이지 조회가 같은 시점의 관심 정보를 보도록 읽기 트랜잭션을 연다.
      return db.transaction(async () => {
        // 선택한 범위의 건수로 링크에 필요한 전체 페이지를 구한다.
        const total = await db.prepare(`SELECT count(*) AS total FROM g2b_interests WHERE ${where}`).get(...args);
        const totalPages = Math.max(1, Math.ceil(Number(total?.total) / COLLECTION_LIST_PAGE_SIZE));
        // 삭제나 오래된 주소로 마지막 페이지를 넘겼으면 유효한 마지막 페이지를 조회한다.
        const page = Math.min(requestedPage, totalPages);
        // 최신순 인덱스의 순서대로 한 페이지의 표시 데이터를 읽는다.
        const rows = await db.prepare(`SELECT business_type AS type, business_number AS number,
          business_revision AS revision, title, registered_at AS registeredAt
          FROM g2b_interests WHERE ${where}
          ORDER BY registered_at DESC, business_type, business_number, business_revision LIMIT ? OFFSET ?`)
          .all(...args, COLLECTION_LIST_PAGE_SIZE, (page - 1) * COLLECTION_LIST_PAGE_SIZE);
        // libSQL 전용 행 객체를 Client Component에서 받을 수 있는 일반 객체로 변환한다.
        const items = rows.map((row): InterestItem => ({
          type: row.type as InterestType,
          number: String(row.number),
          revision: String(row.revision),
          title: String(row.title),
          registeredAt: String(row.registeredAt),
        }));
        // 화면용 데이터와 페이지 정보를 렌더러에 전달한다.
        return { items, page, totalPages };
      }, false);
    },
  };
}

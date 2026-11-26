import type { BusinessApi, BusinessItem } from "@/entities/business/model/business-apis";
import { BUSINESS_APIS, BUSINESS_API_KINDS } from "@/entities/business/model/business-apis";
import type { CollectionDiagnostic } from "@/shared/api/g2b/collection-diagnostic";
import type { G2bDatabase } from "./database";

/**
 * 사업자 및 API별 실행권을 관리하는 저장소를 연다. 호출자는 등록 및 실행권 확보를 같은 쓰기 트랜잭션에서 호출한다.
 * @param db 사업자 마이그레이션이 적용된 연결.
 * @returns 등록 관계, 실행권 및 수집 결과를 저장하는 함수.
 */
export function openBusinessInformation(db: G2bDatabase) {
  /**
   * 공유 사업자를 찾거나 생성하고 현재 사용자와 연결한다.
   * @param userId 인증된 서비스 사용자 ID.
   * @param number 체크섬 검증이 끝난 사업자등록번호.
   * @returns 공유 사업자의 내부 ID.
   * @throws 사업자 또는 연결을 저장하지 못하면 DB 오류를 전달한다.
   */
  async function register(userId: string, number: string) {
    // 번호가 이미 있으면 공유 행을 재사용한다.
    await db.execute({ sql: "INSERT INTO businesses(registration_number) VALUES (?) ON CONFLICT DO NOTHING", args: [number] });
    // 조회와 연결을 한 문장으로 처리하고 같은 사용자의 중복 등록을 허용한다.
    const result = await db.execute({
      sql: `INSERT INTO user_businesses(user_id, business_id)
            VALUES (?, (SELECT id FROM businesses WHERE registration_number = ?))
            ON CONFLICT DO NOTHING RETURNING business_id`,
      args: [userId, number],
    });
    // 기존 연결이면 번호 인덱스로 식별자만 조회한다.
    const row = result.rows[0] ?? await db.prepare("SELECT id AS business_id FROM businesses WHERE registration_number = ?").get(number);
    // 같은 트랜잭션에서 확보한 사업자의 ID를 이후 수집에 사용한다.
    return Number(row!.business_id);
  }

  /**
   * 현재 사용자의 등록 관계에서 공유 사업자 번호를 읽는다.
   * @param userId 인증된 서비스 사용자 ID.
   * @param id 요청한 사업자의 내부 ID.
   * @returns 등록한 사업자의 번호 또는 연결이 없을 때 undefined.
   * @throws 연결 조회에 실패하면 DB 오류를 전달한다.
   */
  async function registeredNumber(userId: string, id: number) {
    // 사용자와 사업자 복합 키로 연결 하나를 확인한다.
    const row = await db.prepare(`SELECT b.registration_number FROM user_businesses u
      JOIN businesses b ON b.id = u.business_id WHERE u.user_id = ? AND u.business_id = ?`).get(userId, id);
    // 등록 관계가 있는 경우에만 수집용 번호를 제공한다.
    return row?.registration_number as string | undefined;
  }

  /**
   * 아직 완료되지 않은 API를 한 문장에서 확보한다.
   * @param id 대상 사업자의 내부 ID.
   * @param token 현재 시도의 고유 실행권.
   * @param now 실행권 만료를 비교할 밀리초 시각.
   * @param until 현재 실행권 만료 시각.
   * @param referenceDate SMPP에서 공통으로 사용할 한국 기준일.
   * @returns 이 시도에서 확보한 업무 유형.
   * @throws 실행권을 저장하지 못하면 DB 오류를 전달한다.
   */
  async function claim(id: number, token: string, now: number, until: number, referenceDate: string) {
    // 각 API 정의에서 기준일 적용 대상을 정하고 SQLite에 한 번에 전달한다.
    const sources = BUSINESS_API_KINDS.map((kind) => ({ kind, date: BUSINESS_APIS[kind].certificate ? referenceDate : null }));
    // 누락 또는 실패 항목과 이전 실행이 만료된 항목만 현재 실행권으로 전환한다.
    const result = await db.execute({
      sql: `INSERT INTO business_collection(business_id, kind, status, reference_date, lease_token, lease_until)
            SELECT ?, value ->> '$.kind', 'running', value ->> '$.date', ?, ? FROM json_each(?) WHERE true
            ON CONFLICT(business_id, kind) DO UPDATE SET status = 'running',
              reference_date = excluded.reference_date, lease_token = excluded.lease_token, lease_until = excluded.lease_until
            WHERE business_collection.status = 'failed' OR
              (business_collection.status = 'running' AND business_collection.lease_until <= ?)
            RETURNING kind`,
      args: [id, token, until, JSON.stringify(sources), now],
    });
    // 실제로 확보한 항목만 외부 요청 대상으로 전달한다.
    return result.rows.map((row) => row.kind as BusinessApi);
  }

  /**
   * 현재 실행권 소유자가 완전한 업무 응답을 저장하고 완료 상태로 전환한다.
   * @param id 대상 사업자의 내부 ID.
   * @param kind 저장할 API 유형.
   * @param token 현재 시도의 실행권.
   * @param items 전체 페이지를 검증한 업무 데이터.
   * @returns 커밋 후 saved, 실행권 만료 또는 인수로 반영하지 않았으면 lease-lost.
   * @throws 데이터 또는 상태를 저장하지 못하면 반영을 취소하고 DB 오류를 전달한다.
   */
  async function complete(id: number, kind: BusinessApi, token: string, items: BusinessItem[]) {
    // 쓰기 트랜잭션에서 실행권 확인과 업무 데이터 교체를 묶는다.
    return db.transaction(async (): Promise<"saved" | "lease-lost"> => {
      // 실행권을 잃은 요청은 후속 시도의 데이터나 상태를 바꿀 수 없다.
      const updated = await db.execute({
        sql: `UPDATE business_collection SET status = 'succeeded', lease_token = NULL, lease_until = NULL,
              error = NULL, diagnostics = NULL
              WHERE business_id = ? AND kind = ? AND lease_token = ? AND lease_until > ?`,
        args: [id, kind, token, Date.now()],
      });
      // 실행권이 만료됐거나 다른 시도가 인수했으면 업무 데이터를 그대로 두고 결과를 구분한다.
      if (!updated.rowsAffected) return "lease-lost";

      // 테이블 선택과 SMPP 유형 조건은 고정된 API 정의에서 가져온다.
      const { table, certificate } = BUSINESS_APIS[kind];
      const scope = certificate ? "business_id = ? AND kind = ?" : "business_id = ?";
      const scopeArgs = certificate ? [id, kind] : [id];
      // 정상 성공한 유형만 새 응답으로 교체하고 다른 사업자·유형은 보존한다.
      await db.execute({ sql: `DELETE FROM ${table} WHERE ${scope}`, args: scopeArgs });
      // 업무 필드 순서가 고정된 JSON을 복합 기본 키로 비교하여 동일 행을 한 번만 저장한다.
      const payloads = JSON.stringify(items.map((item) => JSON.stringify(item)));
      await db.execute({
        sql: certificate
          ? `INSERT INTO ${table}(business_id, kind, payload) SELECT ?, ?, value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`
          : `INSERT INTO ${table}(business_id, payload) SELECT ?, value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`,
        args: [...scopeArgs, payloads],
      });
      // 업무 행 반영을 끝내고 트랜잭션이 커밋되면 호출부에 완료 결과를 전달한다.
      return "saved";
    });
  }

  /**
   * 업무 데이터는 그대로 두고 현재 시도의 실패 진단을 저장한다.
   * @param id 대상 사업자의 내부 ID.
   * @param kind 실패한 API 유형.
   * @param token 현재 시도의 실행권.
   * @param diagnostics 인증 정보를 제거한 공통 오류 진단.
   * @throws 실패 상태를 기록하지 못하면 DB 오류를 전달한다.
   */
  async function fail(id: number, kind: BusinessApi, token: string, diagnostics: CollectionDiagnostic) {
    // 아직 현재 실행권으로 열려 있는 시도에만 요약과 구조화 진단을 기록한다.
    await db.execute({
      sql: `UPDATE business_collection SET status = 'failed', lease_token = NULL, lease_until = NULL,
            error = ?, diagnostics = ? WHERE business_id = ? AND kind = ? AND lease_token = ? AND lease_until > ?`,
      args: [diagnostics.message || "사업자 정보 수집에 실패했습니다.", JSON.stringify(diagnostics), id, kind, token, Date.now()],
    });
  }

  // 등록 서비스에서 트랜잭션 경계를 조합할 수 있게 저장소 동작을 전달한다.
  return { register, registeredNumber, claim, complete, fail };
}

import type { BusinessApi, BusinessItem } from "@/entities/business/model/business-apis";
import { BUSINESS_APIS, BUSINESS_API_KINDS } from "@/entities/business/model/business-apis";
import type { CollectionDiagnostic } from "@/shared/api/g2b/collection-diagnostic";
import type { G2bDatabase } from "./database";

/** 상세 화면에 제공하는 수집 상태이며 누락·만료 상태는 미완료로 표시한다. */
type DisplayStatus = "incomplete" | "running" | "failed" | "succeeded";

/** 한 아코디언의 표시 상태와 저장된 원본 업무 행이다. */
type BusinessSection = {
  /** 다시 수집할 수 있는지 판단하는 화면용 상태. */
  status: DisplayStatus;
  /** 선택한 사업자의 이 유형에 속하는 모든 저장 행. */
  items: BusinessItem[];
};

/** 조달청 테이블에서 유형을 붙이고 SMPP 통합 테이블은 한 번만 읽는 상세 조회다. */
const detailSql = [
  ...BUSINESS_API_KINDS.filter((kind) => !BUSINESS_APIS[kind].certificate).map((kind) =>
    `SELECT '${kind}' AS kind, payload, NULL AS status FROM ${BUSINESS_APIS[kind].table} WHERE business_id = :id`),
  "SELECT kind, payload, NULL AS status FROM business_smpp WHERE business_id = :id",
  `SELECT kind, NULL AS payload, CASE WHEN status = 'running' AND lease_until <= :now
    THEN 'incomplete' ELSE status END AS status FROM business_collection WHERE business_id = :id`,
].join(" UNION ALL ");

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
   * 사용자 연결을 기준으로 목록에서 사용할 최소 식별 정보만 조회한다.
   * @param userId 인증한 내부 사용자 ID.
   * @returns 내부 ID 순서의 사업자 ID, 번호와 확인된 업체명.
   * @throws 조회에 실패하면 DB 오류를 전달한다.
   */
  async function listForUser(userId: string) {
    // 현재 사용자 연결을 읽고 각 사업자의 기본정보에서 첫 유효 업체명만 가져온다.
    const rows = await db.prepare(`SELECT u.business_id, b.registration_number,
      (SELECT NULLIF(trim(json_extract(p.payload, '$.corpNm')), '') FROM business_basic p
        WHERE p.business_id = u.business_id AND NULLIF(trim(json_extract(p.payload, '$.corpNm')), '') IS NOT NULL
        ORDER BY p.payload LIMIT 1) AS name
      FROM user_businesses u JOIN businesses b ON b.id = u.business_id
      WHERE u.user_id = ? ORDER BY u.business_id`).all(userId);
    // 원본 업무 행과 수집 진단을 제외한 목록 모델을 구성한다.
    return rows.map((row) => ({ id: Number(row.business_id), number: String(row.registration_number), name: row.name as string | null }));
  }

  /**
   * 등록 관계를 먼저 검증하고 같은 읽기 트랜잭션에서 선택한 사업자의 상세를 조회한다.
   * @param userId 인증한 내부 사용자 ID.
   * @param id 선택한 사업자의 내부 ID.
   * @returns 등록한 사업자의 번호와 7종 표시 데이터. 관계가 없거나 존재하지 않으면 undefined.
   * @throws 조회 또는 저장 데이터 해석에 실패하면 원인을 전달한다.
   */
  async function detailForUser(userId: string, id: number) {
    // 권한 조회와 업무 조회 사이에 일관된 DB 스냅샷을 사용한다.
    return db.transaction(async () => {
      // 등록 관계가 없으면 업무 테이블을 조회하기 전에 종료한다.
      const number = await registeredNumber(userId, id);
      if (!number) return undefined;

      // 고정된 업무 유형을 초기화해 아직 수집 상태가 없는 경우도 표시한다.
      const sections = Object.fromEntries(BUSINESS_API_KINDS.map((kind) => [kind, { status: "incomplete", items: [] }])) as Record<BusinessApi, BusinessSection>;
      // 선택 사업자의 데이터와 화면 상태만 읽고 오류 진단과 실행권은 전송하지 않는다.
      const { rows } = await db.execute({ sql: detailSql, args: { id, now: Date.now() } });
      for (const row of rows) {
        // 상태와 업무 행을 각각 동일한 아코디언 모델에 모은다.
        const section = sections[row.kind as BusinessApi];
        if (typeof row.payload === "string") section.items.push(JSON.parse(row.payload) as BusinessItem);
        else section.status = row.status as DisplayStatus;
      }
      // 페이지가 이 결과만으로 상세를 렌더링할 수 있게 반환한다.
      return { number, sections };
    }, false);
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
  return { register, registeredNumber, listForUser, detailForUser, claim, complete, fail };
}

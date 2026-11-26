/** 조달청의 API별 테이블 이름으로 마이그레이션에서 고정된 식별자만 사용한다. */
const ppsTables = ["business_basic", "business_industry", "business_product", "business_sanction"];

/** 공유 사업자, 회원 연결, 원본 업무 데이터와 API별 수집 상태를 설치한다. */
export const businessInformationSchema = `
  -- 정규화된 번호 하나당 공동으로 사용하는 사업자 식별자를 만든다.
  CREATE TABLE businesses (
    id INTEGER PRIMARY KEY,
    registration_number TEXT NOT NULL UNIQUE
  );
  -- 사용자별 등록 관계를 한 번만 저장하고 회원 삭제에 맞춰 연결을 정리한다.
  CREATE TABLE user_businesses (
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, business_id)
  ) WITHOUT ROWID;
  -- 사업자를 기준으로 연결을 찾거나 참조 관계를 정리할 때 범위 읽기를 사용한다.
  CREATE INDEX user_businesses_by_business ON user_businesses(business_id);
  -- 실행권, 기준일, 완료 여부와 최근 실패 진단을 사업자와 API별로 유지한다.
  CREATE TABLE business_collection (
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('basic', 'industry', 'product', 'sanction', 'directProduction', 'women', 'disabled')),
    status TEXT NOT NULL CHECK (status IN ('running', 'failed', 'succeeded')),
    reference_date TEXT,
    lease_token TEXT,
    lease_until INTEGER,
    error TEXT,
    diagnostics TEXT,
    PRIMARY KEY (business_id, kind)
  ) WITHOUT ROWID;
  ${ppsTables.map((table) => `
    -- 선택한 사업자의 업무 행만 읽고 원본 필드가 모두 같은 응답의 중복을 방지한다.
    CREATE TABLE ${table} (
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      PRIMARY KEY (business_id, payload)
    ) WITHOUT ROWID;
  `).join("")}
  -- 같은 사업자의 SMPP 응답을 한 테이블에 두고 API 종류별로 조회·저장한다.
  CREATE TABLE business_smpp (
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('directProduction', 'women', 'disabled')),
    payload TEXT NOT NULL,
    PRIMARY KEY (business_id, kind, payload)
  ) WITHOUT ROWID;
`;

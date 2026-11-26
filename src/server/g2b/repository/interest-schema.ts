/** 사용자별 관심 항목의 고유성과 원본 삭제 시 정리를 같은 DB에 정의한다. */
export const interestSchema = `
  CREATE TABLE g2b_interests (
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    business_type TEXT NOT NULL,
    business_number TEXT NOT NULL,
    business_revision TEXT NOT NULL,
    title TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    PRIMARY KEY (user_id, business_type, business_number, business_revision)
  ) WITHOUT ROWID;

  -- 원본 키로 삭제할 때 다른 업무나 사용자의 관심 항목을 읽지 않는다.
  CREATE INDEX g2b_interests_source
    ON g2b_interests (business_type, business_number, business_revision);

  -- 등록일시가 같은 항목은 기본 키의 업무 순서로 배치한다.
  CREATE INDEX g2b_interests_recent
    ON g2b_interests (user_id, registered_at DESC, business_type, business_number, business_revision);
  CREATE INDEX g2b_interests_type_recent
    ON g2b_interests (user_id, business_type, registered_at DESC, business_number, business_revision);

  CREATE TRIGGER g2b_interests_order_plan_delete AFTER DELETE ON order_plans BEGIN
    DELETE FROM g2b_interests WHERE business_type = 'order-plans'
      AND business_number = OLD.number AND business_revision = '';
  END;
  CREATE TRIGGER g2b_interests_prior_spec_delete AFTER DELETE ON prior_specs BEGIN
    DELETE FROM g2b_interests WHERE business_type = 'prior-specs'
      AND business_number = OLD.number AND business_revision = '';
  END;
  CREATE TRIGGER g2b_interests_contract_request_delete AFTER DELETE ON contract_requests BEGIN
    DELETE FROM g2b_interests WHERE business_type = 'contract-requests'
      AND business_number = OLD.number AND business_revision = OLD.revision;
  END;
  CREATE TRIGGER g2b_interests_contract_delete AFTER DELETE ON contracts BEGIN
    DELETE FROM g2b_interests WHERE business_type = 'contracts'
      AND business_number = OLD.number AND business_revision = OLD.revision;
  END;
  CREATE TRIGGER g2b_interests_notice_delete AFTER DELETE ON notices BEGIN
    DELETE FROM g2b_interests WHERE business_type = 'notices'
      AND business_number = OLD.number AND business_revision = OLD.revision;
  END;
  -- 개찰진행차수가 남아 있으면 같은 공고 상세를 계속 열 수 있다.
  CREATE TRIGGER g2b_interests_opening_result_delete AFTER DELETE ON opening_results
  WHEN NOT EXISTS (SELECT 1 FROM opening_results WHERE number = OLD.number AND revision = OLD.revision)
  BEGIN
    DELETE FROM g2b_interests WHERE business_type = 'opening-results'
      AND business_number = OLD.number AND business_revision = OLD.revision;
  END;
`;

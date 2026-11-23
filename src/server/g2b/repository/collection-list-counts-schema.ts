// 업무별 목록이 동일한 구조로 기본 건수를 저장하도록 테이블을 추가하고 입찰공고 집계를 이전한다.
export const collectionListCountsSchema = `
  CREATE TABLE g2b_collection_list_counts (
    section TEXT NOT NULL,
    scope TEXT NOT NULL,
    total INTEGER NOT NULL CHECK (total >= 0),
    collected INTEGER NOT NULL CHECK (collected BETWEEN 0 AND total),
    PRIMARY KEY (section, scope)
  ) WITHOUT ROWID;

  -- 이전 집계값 대신 현재 목록을 기준으로 전체 및 모의공고 제외 범위의 건수를 초기화한다.
  WITH counts AS MATERIALIZED (
    SELECT COUNT(*) AS total, COUNT(collected_at) AS collected,
      COUNT(*) FILTER (WHERE is_mock = 0) AS public_total,
      COUNT(collected_at) FILTER (WHERE is_mock = 0) AS public_collected
    FROM g2b_notice_list
  )
  INSERT INTO g2b_collection_list_counts
    SELECT 'notices', 'all', total, collected FROM counts
    UNION ALL
    SELECT 'notices', 'exclude_mock', public_total, public_collected FROM counts;

  -- 이전 트리거를 제거하고 구버전 목록 조회가 필요한 열을 호환 뷰로 제공한다.
  DROP TRIGGER g2b_notice_list_count_insert;
  DROP TRIGGER g2b_notice_list_count_delete;
  DROP TRIGGER g2b_notice_list_count_update;
  DROP TABLE g2b_notice_list_counts;
  CREATE VIEW g2b_notice_list_counts AS
    SELECT 1 AS id, a.total, a.collected, p.total AS public_total, p.collected AS public_collected
    FROM g2b_collection_list_counts a CROSS JOIN g2b_collection_list_counts p
    WHERE a.section = 'notices' AND a.scope = 'all'
      AND p.section = 'notices' AND p.scope = 'exclude_mock';

  -- 삽입 및 삭제는 전체 건수를 바꾸고 모의공고 제외 범위에는 해당 범위의 공고만 반영한다.
  CREATE TRIGGER g2b_notice_list_count_insert AFTER INSERT ON g2b_notice_list BEGIN
    UPDATE g2b_collection_list_counts SET total = total + 1, collected = collected + (NEW.collected_at IS NOT NULL)
      WHERE section = 'notices' AND scope = 'all';
    UPDATE g2b_collection_list_counts SET total = total + 1, collected = collected + (NEW.collected_at IS NOT NULL)
      WHERE section = 'notices' AND scope = 'exclude_mock' AND NEW.is_mock = 0;
  END;
  CREATE TRIGGER g2b_notice_list_count_delete AFTER DELETE ON g2b_notice_list BEGIN
    UPDATE g2b_collection_list_counts SET total = total - 1, collected = collected - (OLD.collected_at IS NOT NULL)
      WHERE section = 'notices' AND scope = 'all';
    UPDATE g2b_collection_list_counts SET total = total - 1, collected = collected - (OLD.collected_at IS NOT NULL)
      WHERE section = 'notices' AND scope = 'exclude_mock' AND OLD.is_mock = 0;
  END;

  -- 수집 여부와 공개 범위의 변화만 반영해 날짜·최신 시도 등의 변경에는 집계를 쓰지 않는다.
  CREATE TRIGGER g2b_notice_list_count_update AFTER UPDATE OF collected_at, is_mock ON g2b_notice_list
  WHEN (NEW.collected_at IS NULL) <> (OLD.collected_at IS NULL) OR NEW.is_mock IS NOT OLD.is_mock BEGIN
    UPDATE g2b_collection_list_counts
      SET collected = collected + (NEW.collected_at IS NOT NULL) - (OLD.collected_at IS NOT NULL)
      WHERE section = 'notices' AND scope = 'all' AND (NEW.collected_at IS NULL) <> (OLD.collected_at IS NULL);
    UPDATE g2b_collection_list_counts
      SET total = total + (NEW.is_mock = 0) - (OLD.is_mock = 0),
        collected = collected + (NEW.is_mock = 0 AND NEW.collected_at IS NOT NULL)
          - (OLD.is_mock = 0 AND OLD.collected_at IS NOT NULL)
      WHERE section = 'notices' AND scope = 'exclude_mock'
        AND ((NEW.is_mock = 0) <> (OLD.is_mock = 0)
          OR (NEW.is_mock = 0 AND (NEW.collected_at IS NULL) <> (OLD.collected_at IS NULL)));
  END;
`;

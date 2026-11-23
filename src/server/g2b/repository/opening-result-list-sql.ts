// 표시 제목은 연결 공고와 개찰 원본에서 기존 우선순위대로 고른다.
export const openingResultTitleSql = `COALESCE(NULLIF(TRIM(json_extract(notice.data, '$.title')), ''),
        NULLIF(TRIM(json_extract(result.data, '$.price.pbancInfo.bidPbancNm')), ''),
        (SELECT COALESCE(
          NULLIF(TRIM(json_extract(entry.value, '$.detail.bidPbancNm')), ''),
          NULLIF(TRIM(json_extract(entry.value, '$.detail.bidPrgrs.bidPbancNm')), ''),
          NULLIF(TRIM(json_extract(entry.value, '$.detail.bidInfo.bidPbancNm')), '')
        ) AS name FROM json_each(result.data, '$.results') AS entry
        WHERE name IS NOT NULL LIMIT 1)
      )`;
// 표시 업무구분은 연결 공고 코드 또는 개찰 결과의 단일 코드로 결정한다.
export const openingResultBusinessCodeSql = `COALESCE(NULLIF(TRIM(json_extract(notice.data, '$.payload.dmItemMap.prcmBsneSeCd')), ''),
        (SELECT CASE WHEN COUNT(DISTINCT json_extract(entry.value, '$.query.businessCode')) = 1
          THEN MIN(json_extract(entry.value, '$.query.businessCode')) END
          FROM json_each(result.data, '$.results') AS entry)
      )`;
// 표시 라벨에는 기존과 동일하게 연결 공고의 원본 명칭을 사용한다.
export const openingResultBusinessLabelSql = "json_extract(notice.data, '$.payload.dmItemMap.prcmBsneSeNm')";

// 카드 및 기존 조회는 공유한 표시 표현식을 원래 열 이름으로 읽는다.
export const openingResultDisplayColumns = `${openingResultTitleSql} AS title,
  ${openingResultBusinessCodeSql} AS businessCode, ${openingResultBusinessLabelSql} AS businessLabel`;

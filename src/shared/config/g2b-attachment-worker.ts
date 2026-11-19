// 일회 워커는 이 시간 뒤 신규 작업의 선점을 멈추고 실행 중인 작업을 마무리한다.
export const ATTACHMENT_ADMISSION_TIMEOUT_MS = 120_000;
// 상시 워커의 유휴 조회 간격으로, 큐가 비었을 때 DB 조회 빈도를 제한한다.
export const ATTACHMENT_IDLE_POLL_MS = 5_000;
// 수집 진행 호출과 외부 복구 호출이 같은 워크플로 실행을 반복 요청하지 않게 한다.
export const ATTACHMENT_DISPATCH_WINDOW_SECONDS = 600;

// 메타데이터 조회는 개별 요청에 적용하고, 다운로드 제한은 주소 확인과 본문 수신을 포함한다.
export const ATTACHMENT_METADATA_TIMEOUT_MS = 15_000;
export const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 600_000;
// 추출은 다운로드와 별도로 제한하며 자식 V8 힙의 상한은 컨테이너 전체 한도와 구분한다.
export const ATTACHMENT_PDF_EXTRACTION_TIMEOUT_MS = 300_000;
export const ATTACHMENT_PDF_MAX_OLD_SPACE_MIB = 256;

// SQLite의 선점 만료는 초 단위이고 워커의 갱신 타이머는 밀리초 단위다.
export const ATTACHMENT_LEASE_SECONDS = 90;
export const ATTACHMENT_LEASE_RENEWAL_MS = 30_000;
// 첨부 작업은 최초 실행을 포함해 네 번 시도하며 일시 실패 간격은 지수적으로 늘어난다.
export const ATTACHMENT_MAX_ATTEMPTS = 4;
export const ATTACHMENT_RETRY_BASE_SECONDS = 30;
// 수집 완료 이벤트의 등록 실패는 파일 처리와 별도의 재시도 일정을 사용한다.
export const ATTACHMENT_EVENT_RETRY_SECONDS = [30, 60, 120] as const;

# 나라장터 공고 수집 PoC

## 폴더 구조

- `app/`은 Next.js의 페이지와 API 경로, 전역 스타일, TanStack Query Provider를 정의합니다.
- `src/_pages/admin/`은 관리자 전용 메뉴, 경로와 화면 구성을 관리합니다. 나라장터 화면은 `g2b/` 아래에 업무별로 배치합니다. `_pages` 이름은 Next.js Pages Router와의 충돌을 피하기 위해 사용합니다.
- `src/features/collect-g2b/`는 나라장터 업무별 수집, 입력 검증과 수집 UI를 담당합니다. `src/features/download-g2b-attachment/`는 첨부 다운로드를 처리합니다.
- `src/entities/`에는 업무별 원본 타입, 표시 데이터 변환과 화면 컴포넌트가 있습니다.
- `src/server/g2b/repository/`는 여섯 업무가 함께 사용하는 저장소 계약과 Turso 구현을 관리합니다.
- `src/shared/`에는 공용 업무 명칭과 순서, 나라장터 세션·포맷·UI, shadcn/ui 기본 컴포넌트가 있습니다.

## 목록 화면 구성

검색·필터·정렬·페이지 이동이 필요한 새 목록은 `@/shared/ui/list-controls/ListView`의 `ListView`를 사용합니다. 검색과 정렬은 상단 한 줄에 배치하고, 이어서 필터, 결과, 페이지 이동을 표시합니다. 좁은 화면에서는 상단 조작부가 줄바꿈됩니다.

```tsx
<ListView
  search={{ fields, defaultField, value: searchValue, onSubmit: applySearch }}
  sort={{ options: sortOptions, value: sortValue, onChange: applySort }}
  filters={{ filters: filterDefinitions, value: filterValues, onApply: applyFilters }}
  pagination={{ page, totalPages, hrefForPage }}
>
  {results}
</ListView>
```

화면마다 검색 대상·필터 항목·정렬 옵션과 결과 표시만 정합니다. 사용하지 않는 기능은 해당 prop을 생략합니다. 콜백은 클라이언트 컴포넌트에서 연결하고, 목록 조회와 URL 조건은 호출부에서 관리합니다. 검색·필터·정렬을 적용할 때는 1페이지로 돌아가고, 페이지 이동 링크에는 적용된 조건을 유지합니다. 공통 배치를 바꿀 때는 `ListView`를 수정합니다.

## 실행

Node.js 24 이상과 npm으로 실행합니다. Turso Cloud의 SQLite(libSQL) DB를 생성하고 DB URL과 읽기·쓰기 토큰을 `.env.local`의 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`에 설정합니다. 최초 실행 전에 `npm run db:migrate`를 실행합니다. Next.js 서버에서 `selectItemAnncMngV.do`를 HTTP POST로 호출해 물품 공고 상세를 수집합니다.

### 업종 및 법정동 사전 저장소

관리자 사전 화면과 두 로컬 수집 명령은 연결된 Private Vercel Blob을 사용합니다. 로컬 CLI는 프로젝트 루트의 `.env.local`에서 연결 설정을 읽습니다. 기본 접두사는 `dictionaries`이며, 검증 환경은 선택 변수 `DICTIONARY_BLOB_PREFIX`에 별도 접두사를 설정합니다. 같은 사전 데이터를 공유할 환경에는 같은 저장소와 접두사를 사용합니다.

```powershell
node scripts/migrate-dictionaries-to-blob.cjs
node scripts/collect-g2b-industry-law.cjs
node scripts/collect-legal-districts.cjs
```

이전 명령은 Blob에 해당 사전이 비어 있을 때만 기존 로컬 자료를 옮기고 다시 읽어 대조합니다. 원본 위치가 기본값과 다르면 이전 명령에서 `--industry` 또는 `--districts`로 지정합니다. 전환 후 수집과 조회는 Blob에서 수행합니다. 이전 결과를 검증한 뒤 로컬 사전 JSON을 별도로 정리할 수 있습니다.

이전 세대의 정리 지연이 기록되면 해당 접두사의 수집이 끝난 뒤 현재 `metadata.json`의 `listFile`을 확인합니다. 정리 작업에서는 해당 사전의 `rows/` 아래에서 현재 참조가 없는 세대만 대상으로 삼습니다.

### Google 회원가입·로그인 개발 검증

검증용 DB에 마이그레이션 19를 적용하고 `.env.local`에 `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 설정합니다. `AUTH_URL`은 브라우저에서 여는 서비스 origin입니다. Google Cloud의 웹 애플리케이션 OAuth 클라이언트에 `AUTH_URL`과 `/auth/google/callback`을 결합한 콜백 URL을 등록합니다. 로컬 예시는 `http://127.0.0.1:3000/auth/google/callback`입니다.

`/signup`의 초기 동의 문구는 개발 검증용입니다. 공개 가입을 열기 전에 정식 문서와 버전을 연결합니다.

### 마이페이지 프로필 이미지

웹 서버에 Cloudinary 제품 환경의 `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`을 설정합니다. 서버는 업로드·다운로드·삭제와 목록 조회에 이 자격 증명을 사용합니다. `AUTH_URL`은 브라우저에서 접속하는 서비스 주소로 설정합니다.

프로필 파일은 Cloudinary의 `authenticated` 유형으로 저장합니다. 앱이 로그인 사용자와 현재 버전을 검증한 뒤 서버에서 서명한 주소로 파일을 읽어 전달합니다. 버전별 브라우저 캐시는 최대 5분입니다. `npm run profile:cleanup`은 24시간 이상 된 미참조 파일 수를 확인합니다. 실제 삭제는 대상 DB와 Cloudinary 환경을 확인한 뒤 `npm run profile:cleanup -- --apply`로 실행합니다.

### 첨부 처리 워커

1. 웹과 공고 워커를 새 버전으로 전환하기 전에 같은 DB에 `npm run db:migrate`를 적용합니다.
2. `docker compose -f compose.attachments.yaml up -d --build`로 첨부 워커를 시작합니다. 로컬 프로세스로 실행할 때는 `npm run worker:attachments`를 사용합니다.
3. 관리자 상세 화면에서 수동 우선 처리 요청을 허용하려면 웹 서버에 `ATTACHMENT_MANUAL_TOKEN`을 설정합니다. 공고·발주계획·사전규격 상세의 첨부 처리 영역에서 파일 상태와 해시를 볼 수 있습니다.

첨부 워커를 중지한 동안에는 수집 완료 이벤트가 DB에 남고 재시작 뒤 이어서 처리됩니다. 새 작업은 확장자에 등록된 추출기로 처리하며, 미등록 형식은 다운로드와 해시 확인으로 완료합니다. 기존 해시 작업은 관리자 상세의 **추출 요청**으로 추출 작업으로 전환할 수 있습니다. 같은 수집 건에 확장자만 다른 PDF가 있으면 PDF를 우선합니다.

추출용 원본은 임시 파일로만 사용합니다. 동일한 SHA-256, 형식, 추출기 버전으로 완료된 결과는 재사용합니다. PDF 스캔본은 OCR 없이 **텍스트 없음**으로 표시합니다. 운영 반영 후 추출 실패율과 처리 시간, Turso Analytics에서 첨부 이벤트 조회와 선점 쿼리의 평균 Rows Read 및 실행 횟수를 확인합니다.

공통 추출 구조를 배포할 때는 첨부 요청 접수와 워커·첨부 Actions의 신규 실행을 중지하고 진행 중인 작업이 끝날 때까지 기다립니다. 운영 DB를 백업하고 `npm run db:migrate`로 마이그레이션 17을 적용한 후 웹과 워커를 함께 전환합니다. 접수를 재개한 뒤 기존 PDF 미리보기와 신규 PDF 추출을 확인합니다. 구버전으로 복귀할 때는 전환 직전 백업을 사용합니다.

#### GitHub Actions로 원격 실행

1. 위 첨부 추출 배포 순서에 따라 운영 Turso의 마이그레이션과 웹·워크플로 전환을 진행합니다. GitHub Environment `attachment-processing`의 Turso 시크릿이 웹·공고 수집과 같은 DB를 가리키고, 기본 브랜치의 실행을 승인 대기 없이 허용하는지 확인합니다.
2. 기본 브랜치의 공고 수집 Actions는 공고 한 건의 성공을 기록하면 내장 GitHub 토큰으로 첨부 처리 Actions를 호출합니다. Vercel의 관리자 수동 요청과 복구 호출은 `ATTACHMENT_WORKER_MODE=github-actions` 및 기존 `NOTICE_GITHUB_REPOSITORY`, `NOTICE_GITHUB_REF`, `NOTICE_GITHUB_TOKEN`을 사용합니다.
3. cron-job.org에 기존 공고 수집 작업과 별도로 **매분** 실행하는 HTTPS `POST /api/g2b/attachment-queue/tick`을 등록합니다. 요청 헤더는 기존 공고 수집 작업과 같은 `Authorization: Bearer <NOTICE_CRON_TOKEN>`입니다. 응답은 실행 접수 202, 빈 큐 또는 예약 중 204, 인증 실패 401, 설정이나 호출 오류 503입니다. GitHub 자체 예약 실행은 사용하지 않습니다.
4. 여러 공고를 수집하면서 첫 성공 뒤 별도 첨부 Actions가 시작되는지 확인합니다. 관리자 수동 요청과 외부 복구도 각각 확인합니다. 초기 운영에서 시작 지연, 실패율, Actions 사용량과 Turso의 평균 Rows Read 및 실행 횟수를 비교합니다.

로컬에서 같은 일회 모드를 실행하려면 `npm run worker:attachments -- --once`를 사용합니다. 큐가 비면 즉시 종료하고, 실행 시작 2분 뒤에는 신규 작업을 가져오지 않습니다. 이미 선점한 다운로드와 추출은 각 작업 제한 내에서 완료합니다.

대형 PDF 회귀 테스트는 Docker에서 별도로 실행합니다. 50 MiB에 가까운 합성 PDF의 500개 페이지에 벡터 표를 배치하고 그중 240개에 압축 이미지를 넣습니다. 모든 페이지의 텍스트 순서, 추출 시간, 컨테이너 최대 메모리와 OOM 발생 여부를 확인합니다. Docker의 Linux cgroup v2에서 실행하며 운영 DB나 나라장터에 연결하지 않습니다.

```powershell
docker compose -f compose.attachments.yaml build attachments
docker run --rm --network none --memory 512m --cpus 0.5 --mount "type=bind,source=$((Get-Location).Path)\tests,target=/app/tests,readonly" g2b-internal-api-collector-attachments:latest node --test tests/attachment-pdf.stress.cjs
```

첨부 자동 등록에 실패하면 30초, 60초, 120초 후 재시도합니다. 모두 실패하면 이벤트와 마지막 오류가 DB에 남습니다. 원인을 해결한 뒤 Turso SQL 콘솔에서 실패 이벤트 ID를 확인하고, 아래 예시의 `123`을 복구할 ID로 바꿔 실행합니다. 워커는 대상 이벤트를 다시 읽습니다.

```sql
SELECT id, section, number, revision, failures, error
FROM g2b_attachment_events WHERE failed_at IS NOT NULL ORDER BY id;

UPDATE g2b_attachment_events
SET failures = 0, available_at = 0, failed_at = NULL, error = NULL,
    generation = generation + 1
WHERE id = 123 AND failed_at IS NOT NULL;
```

```powershell
npm ci
npm run db:migrate
npm run dev
npm exec -- postman --version
```

브라우저에서 `http://127.0.0.1:3000/admin/g2b/notices`를 열고 공고번호와 차수를 입력합니다. 낙찰방법 코드는 확보한 요청에 값이 있을 때 입력합니다. 수집에 성공하면 TanStack Query가 저장 목록을 다시 읽고 공고 상세로 이동합니다. 저장 목록에서도 공고를 선택해 상세 페이지를 열 수 있습니다.

상세 페이지는 첨부된 나라장터 상세 JS에서 화면 연결을 확인한 필드와 표를 섹션별로 표시합니다. 전체 응답 JSON은 Turso에 보관하며, 화면에는 표시 기준을 충족하는 데이터만 전달합니다.

같은 공고번호와 차수의 자료는 한 행에 저장됩니다. 새 DB에서 수집을 시작하며 기존 로컬 자료는 이전하지 않습니다.

## 공고 수집 워커

로컬에서는 별도 프로세스로 `npm run worker:notices`를 실행합니다. 웹과 워커에 동일한 Turso DB를 설정합니다. 워커는 DB에서 90초 실행권을 획득하고 30초마다 갱신합니다. 공고 수집의 HTTP 202는 큐에 접수됐음을 뜻합니다. 작업 상태는 관리자 메뉴의 공고 수집 큐에서 확인하고 장애 로그는 JSON의 `component: "notice-queue"`로 찾을 수 있습니다.

### GitHub Actions 연동 검증

1. 테스트 Turso DB에 `npm run db:migrate`를 실행합니다. 웹과 GitHub 환경 `notice-collection`에 같은 테스트 DB의 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`을 설정합니다. 수집 워크플로가 GitHub 기본 브랜치에 있어야 호출할 수 있습니다.
2. 테스트 웹 서버에 `NOTICE_WORKER_MODE=github-actions`, `NOTICE_GITHUB_REPOSITORY`(소유자/저장소), `NOTICE_GITHUB_REF`(실행할 브랜치 또는 태그), `NOTICE_GITHUB_TOKEN`(대상 저장소 Actions 쓰기 권한), `NOTICE_CRON_TOKEN`(정기 호출 전용 비밀값)을 설정합니다. 로컬 상시 워커를 함께 실행할 경우 기존 워커가 실행권을 계속 사용하므로 Actions 경로를 검증할 때에는 테스트용 상시 워커를 종료합니다.
3. 배포 환경에서 관리자 화면과 쓰기 API, PDF 페이지 조회 경로(`/api/g2b/attachment-results/*`)를 같은 인증 정책으로 보호합니다. HTTPS의 `POST /api/g2b/notice-queue/tick` 경로만 정기 호출에 허용하고 애플리케이션의 전용 토큰 검증을 사용합니다. cron-job.org에서 매분 POST와 `Authorization: Bearer <NOTICE_CRON_TOKEN>` 헤더를 설정합니다. 응답은 호출을 요청했으면 202, 실행할 작업이 없거나 이미 예약됐으면 204, 인증 실패 시 401, 호출 오류 시 503입니다.
4. 테스트 화면에서 수동 수집과 자동 수집 시작·재개를 요청하고 워크플로 실행 및 Turso 저장을 확인합니다. Actions 호출이 실패해도 큐 접수는 유지됩니다. 다음 정기 호출은 실행 가능한 작업을 재확인하고, 러너가 시작하지 않은 예약은 3분 후 만료됩니다.
5. **공고·첨부 실행 기록 정리**를 `dry_run=true`로 수동 실행해 누적 삭제 후보를 확인합니다. 실제 예약 정리를 활성화하려면 GitHub **Settings → Secrets and variables → Actions → Variables**의 **Repository variables**에 `NOTICE_ACTIONS_CLEANUP_ENABLED=true`를 등록합니다. GitHub가 매시간 17분에 실행을 요청합니다. 두 워크플로의 완료 후 24시간 지난 성공 실행만 정리하며 이전 시도에 실패가 있었던 실행과 실패·취소 기록은 보존합니다.

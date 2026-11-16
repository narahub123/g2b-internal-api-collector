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
3. 배포 환경에서 관리자 화면과 쓰기 API를 인증으로 보호합니다. HTTPS의 `POST /api/g2b/notice-queue/tick` 경로만 정기 호출에 허용하고 애플리케이션의 전용 토큰 검증을 사용합니다. cron-job.org에서 매분 POST와 `Authorization: Bearer <NOTICE_CRON_TOKEN>` 헤더를 설정합니다. 응답은 호출을 요청했으면 202, 실행할 작업이 없거나 이미 예약됐으면 204, 인증 실패 시 401, 호출 오류 시 503입니다.
4. 테스트 화면에서 수동 수집과 자동 수집 시작·재개를 요청하고 워크플로 실행 및 Turso 저장을 확인합니다. Actions 호출이 실패해도 큐 접수는 유지됩니다. 다음 정기 호출은 실행 가능한 작업을 재확인하고, 러너가 시작하지 않은 예약은 3분 후 만료됩니다.
5. 기록 정리는 워크플로 수동 실행의 기본값인 `dry_run`으로 먼저 확인합니다. 저장소 변수 `NOTICE_ACTIONS_CLEANUP_ENABLED=true`를 설정하면 매시간 성공 실행을 정리합니다. 공고 수집 워크플로에서 완료 후 24시간 지난 성공 실행의 전체 기록을 대상으로 하며, 실패한 시도를 포함한 실행은 보존합니다.

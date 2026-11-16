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

별도 프로세스로 `npm run worker:notices`를 실행합니다. 웹과 워커에 동일한 Turso DB를 설정합니다. 워커는 DB에서 90초 실행권을 획득하고 30초마다 갱신합니다. 같은 큐를 사용하는 다른 워커에 유효한 실행권이 있으면 중복 실행을 시작하지 않습니다.
운영 환경에서 워커를 자동 재시작하고 웹·워커 표준 오류를 수집해 보존합니다.
큐 장애 로그는 JSON의 `component: "notice-queue"`로 식별할 수 있습니다.

공고 수집의 HTTP 202는 영속 접수 완료를 뜻합니다. 작업 ID로 상태를 조회하거나
관리자 메뉴의 공고 수집 큐에서 확인할 수 있습니다. 웹과 워커를 함께 배포하고,
전환 시에는 기존 웹과 워커를 종료하고 Turso 스키마를 적용한 뒤 두 프로세스를 시작합니다.

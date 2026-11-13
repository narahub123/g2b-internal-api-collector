# 나라장터 공고 수집 PoC

## 폴더 구조

- `app/`은 Next.js의 페이지와 API 경로, 전역 스타일, TanStack Query Provider를 정의합니다.
- `src/_pages/admin/`은 관리자 전용 메뉴, 경로와 화면 구성을 관리합니다. 나라장터 화면은 `g2b/` 아래에 업무별로 배치합니다. `_pages` 이름은 Next.js Pages Router와의 충돌을 피하기 위해 사용합니다.
- `src/features/collect-g2b/`는 나라장터 업무별 수집, 입력 검증과 수집 UI를 담당합니다. `src/features/download-g2b-attachment/`는 첨부 다운로드를 처리합니다.
- `src/entities/`에는 업무별 원본 타입, 표시 데이터 변환과 화면 컴포넌트가 있습니다.
- `src/server/g2b/repository/`는 여섯 업무가 함께 사용하는 저장소 계약과 SQLite 구현을 관리합니다.
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

Node.js 24 이상과 npm으로 실행합니다. Next.js 서버에서 `selectItemAnncMngV.do`를 HTTP POST로 호출해 물품 공고 상세를 수집합니다.

```powershell
npm ci
npm run dev
npm exec -- postman --version
```

브라우저에서 `http://127.0.0.1:3000/admin/g2b/notices`를 열고 공고번호와 차수를 입력합니다. 낙찰방법 코드는 확보한 요청에 값이 있을 때 입력합니다. 수집에 성공하면 TanStack Query가 저장 목록을 다시 읽고 공고 상세로 이동합니다. 저장 목록에서도 공고를 선택해 상세 페이지를 열 수 있습니다.

상세 페이지는 첨부된 나라장터 상세 JS에서 화면 연결을 확인한 필드와 표를 섹션별로 표시합니다. 전체 응답 JSON은 SQLite에 보관하며, 화면에는 표시 기준을 충족하는 데이터만 전달합니다.

SQLite 데이터는 `.data/notices.sqlite`에 저장됩니다. 공고번호와 차수가 같으면 다시 수집할 때 한 행이 갱신됩니다. PostgreSQL로 이전할 때는 `G2bRepository` 인터페이스를 구현한 저장소를 서버에서 연결하고 기존 데이터를 이전합니다.

## 공고 수집 워커

웹 서버와 같은 프로젝트 디렉터리에서 별도 프로세스로 `npm run worker:notices`를 실행합니다.
두 프로세스는 같은 호스트의 영속 `.data` 디렉터리를 사용합니다.
운영 환경에서 워커를 자동 재시작하고 웹·워커 표준 오류를 수집해 보존합니다.
큐 장애 로그는 JSON의 `component: "notice-queue"`로 식별할 수 있습니다.

공고 수집의 HTTP 202는 영속 접수 완료를 뜻합니다. 작업 ID로 상태를 조회하거나
관리자 메뉴의 공고 수집 큐에서 확인할 수 있습니다. 웹과 워커를 함께 배포하고,
이전 동기 처리 버전으로 돌아갈 때는 먼저 워커를 종료한 뒤 `.data`를 보존합니다.

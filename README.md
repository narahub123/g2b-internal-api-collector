# 나라장터 공고 수집 PoC

## 폴더 구조

- `app/`은 Next.js 페이지와 API 진입점입니다.
- `src/app/`에는 전역 스타일과 TanStack Query Provider가 있습니다.
- `src/_pages/notices/`는 수집 폼과 공고 목록을, `src/_pages/notice-detail/`은 공고 상세 화면을 구성합니다. `_pages` 이름은 Next.js Pages Router와의 충돌을 피하기 위해 사용합니다.
- `src/features/collect-notice/`는 수집 폼, 입력 검증, 수집 요청을 담당합니다.
- `src/entities/notice/`는 공고 타입, 목록·상세 컴포넌트, 저장소를 관리합니다.
- `src/shared/ui/`에는 shadcn/ui 기본 컴포넌트가 있고, `src/shared/lib/`에는 공용 유틸리티가 있습니다.

Node.js 24 이상과 npm으로 실행합니다. Next.js 서버에서 `selectItemAnncMngV.do`를 HTTP POST로 호출해 물품 공고 상세를 수집합니다.

```powershell
npm ci
npm run dev
npm exec -- postman --version
```

브라우저에서 `http://127.0.0.1:3000/admin`을 열고 공고번호와 차수를 입력합니다. 낙찰방법 코드는 확보한 요청에 값이 있을 때 입력합니다. 수집에 성공하면 TanStack Query가 저장 목록을 다시 읽고 공고 상세로 이동합니다. 저장 목록에서도 공고를 선택해 상세 페이지를 열 수 있습니다.

상세 페이지는 첨부된 나라장터 상세 JS에서 화면 연결을 확인한 필드와 표를 섹션별로 표시합니다. 전체 응답 JSON은 SQLite에 보관하며, 화면에는 표시 기준을 충족하는 데이터만 전달합니다.

SQLite 데이터는 `.data/notices.sqlite`에 저장됩니다. 공고번호와 차수가 같으면 다시 수집할 때 한 행이 갱신됩니다. PostgreSQL로 이전할 때는 `NoticeRepository` 인터페이스를 구현하는 저장소를 추가하고 API 라우트에서 연결한 뒤 기존 데이터를 이전하면 됩니다.

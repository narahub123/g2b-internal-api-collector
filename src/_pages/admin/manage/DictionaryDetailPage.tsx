import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_DICTIONARIES_PATH } from "../config/routes";
import { dictionaries } from "./dictionaries";
import { dictionaryServer, formatCount } from "./dictionary-server";
import { dictionaryLists, dictionaryPage, type DictionarySearchParams } from "./dictionary-list";
import { DictionaryListControls } from "./DictionaryListControls";

/**
 * 저장 목록의 현재 페이지와 상세 조건을 표시한다.
 * @param props 경로 식별자와 탐색 조건.
 * @returns 관리자 사전 목록 상세.
 * @throws 등록되지 않은 사전 경로이면 찾을 수 없음 응답.
 */
export async function DictionaryDetailPage({ params, searchParams }: {
  params: Promise<{ dictionary: string }>;
  searchParams: Promise<DictionarySearchParams>;
}) {
  // 경로에서 임의의 저장소 이름에 접근하지 못하도록 등록된 정의를 찾는다.
  const { dictionary } = await params;
  const definition = dictionaries.find(({ id }) => id === dictionary);
  if (!definition) notFound();
  const { id, href, title } = definition;
  // 표는 로컬 저장 목록을 사용하고 원본에는 요청하지 않는다.
  const stored = await readRows(id);
  const columns: readonly (readonly [string, string])[] = dictionaryLists[id].columns;
  const result = stored.rows && dictionaryPage(id, stored.rows, await searchParams);
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link href={ADMIN_DICTIONARIES_PATH} className="text-sm text-muted-foreground hover:underline">사전 목록 관리</Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>
      {/* 조회 실패와 미수집을 구분하고 저장본이 있으면 조건을 제공한다. */}
      {stored.failed && <p role="alert" className="text-destructive">저장된 목록을 조회하지 못했습니다.</p>}
      {!stored.failed && !result && <p className="text-muted-foreground">아직 수집된 자료가 없습니다.</p>}
      {result && (
        <DictionaryListControls href={href} fields={result.fields} search={result.search}
          filters={result.filters} values={result.values} page={result.page} totalPages={result.totalPages}>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">검색 결과 {formatCount(result.total)}</p>
            {!result.rows.length ? <p className="py-6 text-muted-foreground">조건에 맞는 자료가 없습니다.</p> : (
              // 넓은 원본 열은 페이지 전체 폭 대신 표 안에서 스크롤한다.
              <div className="overflow-x-auto rounded-lg border">
                <table aria-label={title} className="w-full whitespace-nowrap text-left text-sm">
                  <thead className="bg-muted">
                    <tr>{columns.map(([key, label]) => <th key={key} scope="col" className="px-3 py-2">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {/* 원본에는 동일 코드와 동일 행도 있을 수 있어 페이지 내 위치로 행을 구분한다. */}
                    {result.rows.map((row, index) => (
                      <tr key={index} className="border-t">
                        {columns.map(([key]) => <td key={key} className="max-w-96 whitespace-pre-wrap break-words px-3 py-2">{row[key]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DictionaryListControls>
      )}
    </section>
  );
}

/**
 * 조회 예외를 다른 목록 상태와 구분해 전달한다.
 * @param id 저장본을 읽을 사전.
 * @returns 저장 목록과 조회 실패 여부.
 */
async function readRows(id: (typeof dictionaries)[number]["id"]) {
  try {
    return { rows: await dictionaryServer[id].rows(), failed: false };
  } catch (error) {
    console.error("[사전 목록]", id, error);
    return { rows: undefined, failed: true };
  }
}

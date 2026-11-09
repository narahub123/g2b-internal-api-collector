import { decodeHTMLStrict } from "entities";
import Link from "next/link";
import type { NoticeKey } from "@/entities/notice/model/types";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/detail-accordion-section";
import { RecollectButton } from "@/shared/ui/recollect-button";
import { openingResultPath, type OpeningResult } from "../model/opening-result";
import {
  getOpeningResultDisplay,
  type DisplayField,
  type DisplayTable,
} from "../model/opening-result-display";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return decodeHTMLStrict(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function Fields({ fields }: { fields: DisplayField[] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      {fields.map(({ key, label, value, href }) => (
        <div key={key} className="grid gap-1 sm:contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="wrap-anywhere whitespace-pre-wrap">
            {href ? (
              <Link
                href={href}
                className="text-primary underline underline-offset-2"
              >
                {display(value)}
              </Link>
            ) : (
              display(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ResultTable({ table }: { table: DisplayTable }) {
  if (!table.rows.length)
    return (
      <p className="text-sm text-muted-foreground">조회된 목록이 없습니다.</p>
    );
  if (!table.columns.length)
    return (
      <p className="text-sm text-muted-foreground">
        표시할 수 있는 목록 항목이 없습니다.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary">
          <tr>
            {table.columns.map(({ key, label }) => (
              <th key={key} scope="col" className="whitespace-nowrap px-3 py-2">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-t align-top">
              {table.columns.map(({ key }) => (
                <td
                  key={key}
                  className="min-w-20 whitespace-pre-wrap px-3 py-2"
                >
                  {display(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OpeningResultDetail({
  noticeKey,
  results,
  title,
}: {
  noticeKey: NoticeKey;
  results: OpeningResult[];
  title?: string;
}) {
  // 개찰차수와 분류는 데이터 그룹 키일 뿐, 원본 화면에 없는 제목으로 출력하지 않는다.
  const sections = results.flatMap((result) =>
    result.results.flatMap(({ query, detail }) =>
      getOpeningResultDisplay(query, detail).sections.map((section, index) => ({
        key: `${result.openingRevision}/${query.classification}/${index}`,
        section,
      })),
    ),
  );

  // 공지사항은 개찰결과 섹션보다 앞에 배치하며, 같은 게시글은 한 번만 표시한다.
  const notices = Array.from(
    new Map(
      results
        .flatMap((result) => (result.notice ? [result.notice] : []))
        .map((notice) => [`${notice.bbsNo}/${notice.pstNo}`, notice] as const),
    ).values(),
  );

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div>
          <h2 className="wrap-anywhere text-xl font-semibold">
            {title ?? "개찰결과 상세"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {noticeKey.number} / {noticeKey.revision}
          </p>
        </div>
        <RecollectButton endpoint={`/api${openingResultPath(noticeKey)}`} />
      </header>
      {notices.length > 0 && (
        <dl className="grid gap-2 border-t pt-4  pl-4 -mb-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="font-medium">공지사항</dt>
          <dd className="grid min-w-0 gap-2">
            {notices.map((notice) => (
              <p
                key={`${notice.bbsNo}/${notice.pstNo}`}
                className="wrap-anywhere whitespace-pre-wrap"
              >
                ({display(notice.inptDt)}) {display(notice.pstNm)}
              </p>
            ))}
          </dd>
        </dl>
      )}
      <div className="grid min-w-0 gap-3">
        {sections.map(({ key, section }) => (
          <Accordion
            key={key}
            type="multiple"
            defaultValue={[section.title]}
            className="min-w-0 border-t"
          >
            <DetailAccordionSection title={section.title} heading="h3">
              {section.kind === "fields" ? (
                <Fields fields={section.fields} />
              ) : (
                <ResultTable table={section.table} />
              )}
            </DetailAccordionSection>
          </Accordion>
        ))}
      </div>
    </article>
  );
}

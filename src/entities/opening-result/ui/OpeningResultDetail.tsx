import { decodeHTMLStrict } from "entities";
import Link from "next/link";
import type { NoticeKey } from "@/entities/notice/model/types";
import { formatG2bDisplayDateTime } from "@/shared/lib/g2b-display-format";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/detail-accordion-section";
import { RecollectButton } from "@/shared/ui/recollect-button";
import { DetailTitle } from "@/shared/ui/detail-title";
import type { G2bBusiness } from "@/shared/lib/g2b-business";
import { openingResultPath, type OpeningResult } from "../model/opening-result";
import {
  getOpeningResultDisplay,
  getOpeningResultPriceDisplay,
  type DisplayField,
  type DisplayTable,
  type OpeningResultDisplay,
} from "../model/opening-result-display";

/**
 * API 응답값을 화면에 표시할 문자열로 변환한다.
 * 문자열은 HTML 엔티티를 해제하고, 빈 값은 빈 문자열로 유지한다.
 * @param value 표시할 원본 값.
 * @returns 화면에 표시할 문자열.
 */
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return decodeHTMLStrict(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

type PriceSections = OpeningResultDisplay["sections"];

/**
 * 공고정보의 필드를 정의된 순서대로 출력한다.
 * reservePrice는 일반 텍스트 값이 아니라 같은 개찰차수의 가격 상세 섹션을
 * 해당 필드의 값 영역에 중첩 아코디언으로 표시한다.
 * @param fields 표시할 공고정보 필드 목록.
 * @param priceSections 해당 개찰차수의 가격 상세 섹션. 없으면 중첩 내용을 표시하지 않는다.
 */
function Fields({
  fields,
  priceSections = [],
}: {
  fields: DisplayField[];
  priceSections?: PriceSections;
}) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      {fields.map(({ key, label, value, href }) => (
        <div key={key} className="grid gap-1 sm:contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 wrap-anywhere whitespace-pre-wrap">
            {/* 가격 상세는 별도 최상위 섹션을 만들지 않고 원래 필드 위치에 삽입한다. */}
            {key === "reservePrice" ? (
              priceSections.length > 0 ? (
                <div className="grid min-w-0 gap-2">
                  {priceSections.map((section, index) => (
                    <Accordion
                      key={`${section.title}/${index}`}
                      type="multiple"
                      defaultValue={[section.title]}
                      className="min-w-0 border-t text-sm [&_button]:py-2 [&_button]:text-sm"
                    >
                      <DetailAccordionSection
                        title={section.title}
                        heading="h3"
                      >
                        {/* 가격 상세도 필드형과 표형 섹션을 동일한 표시 컴포넌트로 처리한다. */}
                        {section.kind === "fields" ? (
                          <Fields fields={section.fields} />
                        ) : (
                          <ResultTable table={section.table} />
                        )}
                      </DetailAccordionSection>
                    </Accordion>
                  ))}
                </div>
              ) : null
            ) : href ? (
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

/**
 * 개찰결과 및 예비가격정보의 표를 공통 렌더링한다.
 * 행 또는 표시 가능한 열이 없으면 빈 표 대신 해당 사유를 안내한다.
 * @param table 표시 열 정의와 행 데이터.
 */
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

/**
 * 개찰결과 응답을 공고정보·목록 등의 화면 섹션으로 구성한다.
 * 가격 상세는 동일 개찰차수의 공고정보 필드에만 연결하며,
 * 공지사항은 게시글 식별자로 중복을 제거해 결과 섹션보다 먼저 표시한다.
 * @param noticeKey 현재 입찰공고 식별자.
 * @param results 개찰차수별 조회 결과.
 * @param title 화면 제목. 생략하면 기본 제목을 사용한다.
 * @param business 연결 공고나 저장된 조회 조건에서 결정한 업무구분.
 */
export function OpeningResultDetail({
  noticeKey,
  results,
  title,
  business,
  originalHref,
}: {
  noticeKey: NoticeKey;
  results: OpeningResult[];
  title?: string;
  business?: G2bBusiness;
  originalHref?: string;
}) {
  // 개찰차수와 분류는 데이터 그룹 키일 뿐, 원본 화면에 없는 제목으로 출력하지 않는다.
  const sections = results.flatMap((result) => {
    // 가격 상세가 없는 개찰차수에는 빈 목록을 전달해 중첩 내용을 표시하지 않는다.
    const priceSections = result.price
      ? getOpeningResultPriceDisplay(result.price).sections
      : [];
    return result.results.flatMap(({ query, detail }) =>
      getOpeningResultDisplay(query, detail).sections.map((section, index) => ({
        // 개찰차수·업무 분류·섹션 순서로 서로 다른 조회 결과의 렌더링 키를 구분한다.
        key: `${result.openingRevision}/${query.classification}/${index}`,
        section,
        // 동일 개찰차수의 가격 정보는 공고정보 필드에만 연결한다.
        priceSections:
          section.kind === "fields" && section.title === "공고정보"
            ? priceSections
            : [],
      })),
    );
  });

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
      <DetailTitle
        title={title ?? "개찰결과 상세"}
        subtitle={`${noticeKey.number} / ${noticeKey.revision}`}
        business={business}
        originalHref={originalHref}
        headingLevel="h2"
        actions={
          <RecollectButton
            endpoint={`/api${openingResultPath(noticeKey)}`}
            compact
          />
        }
      />
      {/* 공지사항이 없는 경우에는 제목과 빈 영역도 생성하지 않는다. */}
      {notices.length > 0 && (
        <dl className="grid gap-2 border-t pt-4  pl-4 -mb-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="font-medium">공지사항</dt>
          <dd className="grid min-w-0 gap-2">
            {notices.map((notice) => (
              <p
                key={`${notice.bbsNo}/${notice.pstNo}`}
                className="wrap-anywhere whitespace-pre-wrap"
              >
                ({formatG2bDisplayDateTime(display(notice.inptDt))}) {display(notice.pstNm)}
              </p>
            ))}
          </dd>
        </dl>
      )}
      <div className="grid min-w-0 gap-3">
        {sections.map(({ key, section, priceSections }) => (
          <Accordion
            key={key}
            type="multiple"
            defaultValue={[section.title]}
            className="min-w-0 border-t"
          >
            <DetailAccordionSection title={section.title} heading="h3">
              {section.kind === "fields" ? (
                <Fields fields={section.fields} priceSections={priceSections} />
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

import type { ReactNode } from "react";
import { Fragment } from "react";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import { DetailTitle } from "@/shared/ui/g2b/DetailTitle";
import { DetailInterest } from "@/features/g2b-interest/DetailInterest";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { type Contract } from "../model/contract";
import { contractDisplay } from "../model/contract-display";

/**
 * 계약현황의 복합 목록을 아코디언 표로 렌더링한다.
 * 빈 데이터 행·빈 표는 contractDisplay에서 이미 제외한 상태로 전달된다.
 * @param props 표 제목, 열, 표시할 행 및 2행 구성 정보와 제목 영역의 동작.
 * @returns 기존 병합 셀 구성을 유지하는 계약현황 표.
 */
function ContractTable({
  title,
  columns,
  rows,
  pairedRows,
}: ReturnType<typeof contractDisplay>["tables"][number]) {
  // 물품 표는 열 일부를 두 번째 헤더·데이터 행에 배치한다.
  // 일반 표는 전체 열을 첫 행에 표시한다.
  const firstRowLength = pairedRows?.firstRowLength ?? columns.length;
  // 첫 번째·두 번째 행에 배치할 열을 분리하되 원본 열 순서는 변경하지 않는다.
  const firstColumns = columns.slice(0, firstRowLength);
  const secondColumns = columns.slice(firstRowLength);
  // 공유 열(No·인도조건)은 원본 물품 표처럼 두 행에 걸쳐 병합한다.
  const columnSpan = (index: number) =>
    pairedRows?.sharedColumns.includes(index) ? 2 : undefined;
  // 모든 헤더와 데이터 셀에 동일한 여백·줄바꿈 정책을 적용한다.
  const headerClass = "whitespace-nowrap px-3 py-2";
  const cellClass = "whitespace-pre-wrap px-3 py-2";

  return (
    <DetailAccordionSection title={title} heading="h3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm" aria-label={title}>
          <thead className="bg-secondary">
            <tr>
              {firstColumns.map((label, index) => (
                <th
                  key={`${index}-${label}`}
                  scope="col"
                  rowSpan={columnSpan(index)}
                  className={headerClass}
                >
                  {label}
                </th>
              ))}
            </tr>
            {/* 물품 표에만 두 번째 헤더 행을 출력한다. */}
            {pairedRows && (
              <tr>
                {secondColumns.map((label) => (
                  <th key={label} scope="col" className={headerClass}>
                    {label}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {/* 표시할 값이 없는 행은 모델 단계에서 제외되므로 빈 행 안내를 출력하지 않는다. */}
            {rows.map((row) => (
              <Fragment key={row[0]}>
                <tr className="border-t">
                  {firstColumns.map((label, index) => (
                    <td
                      key={label}
                      rowSpan={columnSpan(index)}
                      className={cellClass}
                    >
                      {row[index]}
                    </td>
                  ))}
                </tr>
                {/* 병합 대상 열을 제외한 나머지 값은 두 번째 데이터 행에 출력한다. */}
                {pairedRows && (
                  <tr className="border-t">
                    {secondColumns.map((label, index) => (
                      <td key={label} className={cellClass}>
                        {row[firstRowLength + index]}
                      </td>
                    ))}
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </DetailAccordionSection>
  );
}

/**
 * 저장된 계약현황의 상세 필드와 복합 목록을 아코디언으로 표시한다.
 * @param props 저장된 계약 상세 및 목록.
 * @returns 계약현황 상세 본문.
 */
export function ContractDetail({
  contract,
  actions,
}: {
  contract: Contract;
  actions?: ReactNode;
}) {
  // 표시 모델에서 빈 필드·빈 행·빈 섹션·빈 테이블을 이미 제외한다.
  // 여기서는 필터링 결과만 렌더링해 표시 순서와 기존 표 병합 구조를 유지한다.
  const { title, sections, tables } = contractDisplay(contract);
  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      {/* 동일 업무를 보는 사용자·관리자 상세에서 공통 관심 상태를 표시한다. */}
      <DetailTitle
        interest={<DetailInterest item={{ type: "contracts", number: contract.number, revision: contract.revision }} />}
        title={title.trim() || "계약현황"}
        subtitle={`${contract.number} / ${contract.revision}`}
        business={resolveG2bBusiness(
          contract.detail.prcmBsneSeCd,
          contract.detail.prcmBsneSeNm,
        )}
        headingLevel="h2"
        actions={actions}
      />
      {/* 표시 모델에 남은 섹션·표만 열고, 기존 배열 순서대로 배치한다. */}
      <Accordion
        type="multiple"
        defaultValue={[...sections, ...tables].map(({ title }) => title)}
        className="min-w-0 border-t"
      >
        {/* 빈값 필드는 모델에서 라벨과 값이 함께 제거되었다. */}
        {sections.map(({ title, rows }) => (
          <DetailAccordionSection key={title} title={title} heading="h3">
            <dl className="grid gap-3 text-sm">
              {rows.map(({ label, value, href }) => (
                <div
                  key={label}
                  className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-h-5 wrap-anywhere whitespace-pre-wrap">
                    {/* 링크 필드는 앵커로, 일반 필드는 텍스트로 렌더링한다. */}
                    {href ? (
                      <a
                        href={href}
                        className="text-primary underline underline-offset-2"
                      >
                        {value}
                      </a>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </DetailAccordionSection>
        ))}
        {/* 데이터가 없는 테이블은 모델에서 제외되므로 아코디언도 생성하지 않는다. */}
        {tables.map((table) => (
          <ContractTable key={table.title} {...table} />
        ))}
      </Accordion>
    </article>
  );
}

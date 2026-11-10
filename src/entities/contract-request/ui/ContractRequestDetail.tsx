import { contractRequestApiPath } from "@/shared/lib/routes";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/detail-accordion-section";
import { DetailTitle } from "@/shared/ui/detail-title";
import { resolveG2bBusiness } from "@/shared/lib/g2b-business";
import { RecollectButton } from "@/shared/ui/recollect-button";
import { type ContractRequest } from "../model/contract-request";

import {
  detailValue,
  formatValue,
  getContractRequestDisplay,
} from "../model/contract-request-display";

function DetailFields({
  detail,
  fields,
}: {
  detail: Record<string, unknown>;
  fields: readonly (readonly [string, string])[];
}) {
  return (
    <dl className="grid gap-3 text-sm">
      {fields.map(([key, label]) => {
        const value = detailValue(detail, key);
        if (value === undefined) return null;
        return (
          <div
            key={`${key}/${label}`}
            className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="wrap-anywhere whitespace-pre-wrap">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * 계약요청 상세와 품목을 아코디언으로 표시한다.
 * @param props 저장된 계약요청과 품목.
 * @returns 페이지 또는 탭에 넣을 계약요청 상세 본문.
 */
export function ContractRequestDetail({
  contractRequest,
}: {
  contractRequest: ContractRequest;
}) {
  const { detail, items, number, revision } = contractRequest;
  const { sections, amountFields, showAmounts, columns, showItemList } =
    getContractRequestDisplay(detail, items);

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <DetailTitle
        title={formatValue(detail.bizNm) ?? "계약요청 상세"}
        subtitle={`${number} / ${revision}`}
        business={resolveG2bBusiness(undefined, detail.prcmBsneAreaNm)}
        headingLevel="h2"
        actions={
          <RecollectButton
            endpoint={contractRequestApiPath(contractRequest)}
            compact
          />
        }
      />
      <Accordion
        type="multiple"
        defaultValue={[...sections.map(({ title }) => title), "요청물품정보"]}
        className="min-w-0 border-t"
      >
        {sections.map(({ title, fields }) => (
          <DetailAccordionSection key={title} title={title} heading="h3">
            <DetailFields detail={detail} fields={fields} />
          </DetailAccordionSection>
        ))}
        {(showAmounts || showItemList) && (
          <DetailAccordionSection title="요청물품정보" heading="h3">
            {showAmounts && amountFields && (
              <div className="mb-4 grid gap-3">
                <h4 className="font-medium">요청금액정보</h4>
                <DetailFields detail={detail} fields={amountFields} />
              </div>
            )}
            {showItemList && (
              <>
                <h4 className="mb-3 font-medium">요청물품목록</h4>
                <div className="overflow-x-auto rounded-md border">
                  <table
                    className="w-full text-left text-sm"
                    aria-label="요청물품목록"
                  >
                    <thead className="bg-secondary">
                      <tr>
                        {columns.map(([key, label]) => (
                          <th
                            key={key}
                            scope="col"
                            className="whitespace-nowrap px-3 py-2"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={index} className="border-t">
                          {columns.map(([key]) => (
                            <td key={key} className="px-3 py-2">
                              {formatValue(item[key], key)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </DetailAccordionSection>
        )}
      </Accordion>
    </article>
  );
}

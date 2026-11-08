import { decodeHTMLStrict } from 'entities';
import { Accordion } from '@/shared/ui/accordion';
import { DetailAccordionSection } from '@/shared/ui/detail-accordion-section';
import { RecollectButton } from '@/shared/ui/recollect-button';
import { contractRequestPath, type ContractRequest } from '../model/contract-request';

const groups = [
  { title: '계약요청 정보', fields: [
    ['bizNo', '계약요청접수번호'], ['bizOrd', '차수'], ['bizYmd', '요청일자'],
    ['prcmBsneAreaNm', '조달업무구분'], ['bizDtlItm46', '조달방법'],
    ['ctrtTyNm', '계약유형'], ['bidCtrtMthdNm', '계약방법'],
  ] },
  { title: '기관 및 담당자', fields: [
    ['dmstUntyGrpNm', '수요기관'], ['pbancInstUntyGrpNm', '조달기관'],
    ['bizDtlItm03', '담당부서'], ['bizDtlItm04', '담당자'], ['bizDtlItm05', '전화번호'],
  ] },
  { title: '예산 정보', fields: [
    ['bgtAmt', '예산액(원)'], ['prspPrce', '추정가격(원)'],
    ['totlBgtAmt', '총예산액(원)'], ['ctrtAmt', '계약금액(원)'],
  ] },
] as const;

const itemFields = [
  ['dtlsPrnmNo', '세부품명번호'], ['dtlsPrnm', '세부품명'], ['itemIdnfNm', '물품식별명'],
  ['ctrtDmndQty', '요청수량'], ['qtyUntNm', '단위'], ['ctrtDmndUprc', '요청단가(원)'],
  ['ctrtDmndAmt', '요청금액(원)'], ['dlvgdsTermNody', '납품일수'],
  ['dlvgdsPlacNm', '납품장소'], ['devyCndtNm', '인도조건'],
] as const;

const numberFormat = new Intl.NumberFormat('ko-KR');

function formatValue(value: unknown) {
  if (typeof value === 'number') return numberFormat.format(value);
  if (typeof value === 'string' && value.trim()) return decodeHTMLStrict(value);
}

/**
 * 계약요청 상세와 품목을 아코디언으로 표시한다.
 * @param props 저장된 계약요청과 품목.
 * @returns 페이지 또는 탭에 넣을 계약요청 상세 본문.
 */
export function ContractRequestDetail({ contractRequest }: { contractRequest: ContractRequest }) {
  const { detail, items, number, revision } = contractRequest;
  const sections = groups.map(({ title, fields }) => ({
    title,
    rows: fields.flatMap(([key, label]) => {
      const value = formatValue(detail[key]);
      return value === undefined ? [] : [{ key, label, value }];
    }),
  })).filter(({ rows }) => rows.length > 0);

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div>
          <h2 className="wrap-anywhere text-xl font-semibold">{formatValue(detail.bizNm) ?? '계약요청 상세'}</h2>
          <p className="text-sm text-muted-foreground">{number} / {revision}</p>
        </div>
        <RecollectButton endpoint={`/api${contractRequestPath(contractRequest)}`} />
      </header>
      <Accordion type="multiple" defaultValue={[...sections.map(({ title }) => title), '요청 품목']} className="min-w-0 border-t">
        {sections.map(({ title, rows }) => (
          <DetailAccordionSection key={title} title={title} heading="h3">
            <dl className="grid gap-3 text-sm">
              {rows.map(({ key, label, value }) => (
                <div key={key} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="wrap-anywhere whitespace-pre-wrap">{value}</dd>
                </div>
              ))}
            </dl>
          </DetailAccordionSection>
        ))}
        <DetailAccordionSection title="요청 품목" heading="h3">
          {items.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm" aria-label="요청 품목">
                <thead className="bg-secondary">
                  <tr>{itemFields.map(([key, label]) => <th key={key} scope="col" className="whitespace-nowrap px-3 py-2">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={index} className="border-t">
                      {itemFields.map(([key]) => <td key={key} className="px-3 py-2">{formatValue(item[key]) ?? '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-muted-foreground">조회된 요청 품목이 없습니다.</p>}
        </DetailAccordionSection>
      </Accordion>
    </article>
  );
}

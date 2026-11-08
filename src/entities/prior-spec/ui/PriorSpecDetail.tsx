import { decodeHTMLStrict } from 'entities';
import Link from 'next/link';
import { noticePath } from '@/entities/notice/lib/notice-path';
import type { NoticeKey } from '@/entities/notice/model/types';
import { orderPlanPath } from '@/entities/order-plan/model/order-plan';
import { attachmentGroup, publicAttachmentFiles } from '@/shared/model/g2b-attachments';
import { g2bNumber } from '@/shared/model/g2b-number';
import { Accordion } from '@/shared/ui/accordion';
import { DetailAccordionSection } from '@/shared/ui/detail-accordion-section';
import { RecollectButton } from '@/shared/ui/recollect-button';
import type { PriorSpec } from '../model/prior-spec';

const basicFields = [
  ['bfSpecRegNo', '사전규격등록번호'], ['prcmBsneSeCdNm', '업무구분'],
  ['usrDocNoVal', '참조번호'], ['alotBgtPrspAmt', '배정예산액(원)'],
  ['specRlsDt', '공개일시'], ['opnnRegDdlnDt', '의견등록 마감일시'],
  ['dlvgdsTermYmd', '납품기한'], ['dlvgdsTermNody', '납품일수'],
  ['swBizTrgtYnNm', 'SW사업대상'], ['pvctTrgtYnNm', '수의계약 대상'],
  ['pvctRsn', '수의계약 사유'], ['atetMatr', '유의사항'],
] as const;

const agencyFields = [
  ['dmstUntyGrpNm', '수요기관'], ['pbancInstUntyGrpNm', '공고기관'],
  ['pbancBsneNm', '공고 담당자'], ['pbancBsneTel', '담당자 전화번호'],
] as const;

const tables: readonly { key: string; title: string; fields: readonly (readonly [string, string])[] }[] = [
  { key: 'dlBfSpecItemL', title: '물품 정보', fields: [
    ['dtlsPrnmNo', '세부품명번호'], ['dtlsPrnmNm', '세부품명'], ['itemCfnm', '물품분류명'],
    ['itemQty', '수량'], ['iritemClsfNm', '자체물품분류명'],
  ] },
  { key: 'dlDmstPicRcptL', title: '수요기관 담당자', fields: [
    ['deptNm', '부서'], ['picNm', '담당자'], ['tlphNo', '전화번호'],
  ] },
  { key: 'dlBfSpecOpnnL', title: '규격서 의견', fields: [
    ['opnnNm', '제목'], ['ogdpNm', '소속'], ['wrtrNm', '작성자'], ['inptDt', '등록일시'],
  ] },
] as const;

const numberFormat = new Intl.NumberFormat('ko-KR');
const linkStyle = 'text-primary underline underline-offset-2';

function textValue(value: unknown) {
  if (typeof value === 'number') return numberFormat.format(value);
  if (typeof value === 'string' && value.trim()) return decodeHTMLStrict(value);
}

function Details({ detail, fields }: {
  detail: Record<string, unknown>;
  fields: readonly (readonly [string, string])[];
}) {
  return (
    <dl className="grid gap-3 text-sm">
      {fields.map(([key, label]) => {
        const value = textValue(detail[key]);
        return value === undefined ? null : (
          <div key={key} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="wrap-anywhere whitespace-pre-wrap">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * 사전규격 상세, 관련 자료 및 파일첨부를 아코디언으로 표시한다.
 * @param props 저장된 사전규격과 이를 참조하는 공고 번호 및 차수.
 * @returns 페이지나 탭에서 재사용할 상세 본문.
 */
export function PriorSpecDetail({ spec, notices }: { spec: PriorSpec; notices: NoticeKey[] }) {
  const detail = spec.payload.dlBfSpecM;
  const orderPlan = g2bNumber(detail.oderPlanNo) ?? g2bNumber(detail.oderPlanNoTmp);
  const endpoint = `/api/prior-specs/${encodeURIComponent(spec.number)}`;
  const group = attachmentGroup(detail.untyAtchFileNo);
  const files = publicAttachmentFiles(group, spec.attachments);
  const pending = Boolean(group && !spec.attachments);
  const showFiles = files.length > 0 || pending;
  const visibleTables = tables.flatMap((table) => {
    const rows = spec.payload[table.key];
    return Array.isArray(rows) && rows.length ? [{ ...table, rows }] : [];
  });
  const sections = ['사전규격 정보', '기관 및 담당자', '관련 공고 정보', ...visibleTables.map(({ title }) => title)];
  if (showFiles) sections.push('파일첨부');

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h2 className="wrap-anywhere text-xl font-semibold">{textValue(detail.bfSpecNm) ?? '사전규격 상세'}</h2>
          <p className="text-sm text-muted-foreground">{spec.number}</p>
        </div>
        <RecollectButton endpoint={endpoint} />
      </header>
      <Accordion type="multiple" defaultValue={sections} className="min-w-0 border-t">
        <DetailAccordionSection title="사전규격 정보" heading="h3">
          <Details detail={detail} fields={basicFields} />
        </DetailAccordionSection>
        <DetailAccordionSection title="기관 및 담당자" heading="h3">
          <Details detail={detail} fields={agencyFields} />
        </DetailAccordionSection>
        <DetailAccordionSection title="관련 공고 정보" heading="h3">
          <ul className="grid gap-2 text-sm">
            {orderPlan && (
              <li>발주계획번호 <Link href={orderPlanPath(orderPlan)} className={linkStyle}>{orderPlan}</Link></li>
            )}
            {notices.map((notice) => (
              <li key={noticePath(notice)}>
                입찰공고 <Link href={noticePath(notice)} className={linkStyle}>{notice.number} / {notice.revision}</Link>
              </li>
            ))}
            {!notices.length && <li className="text-muted-foreground">수집된 관련 입찰공고가 없습니다.</li>}
          </ul>
        </DetailAccordionSection>
        {visibleTables.map(({ title, fields, rows }) => (
          <DetailAccordionSection key={title} title={title} heading="h3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm" aria-label={title}>
                <thead className="bg-secondary">
                  <tr>{fields.map(([key, label]) => <th key={key} scope="col" className="whitespace-nowrap px-3 py-2">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-t">
                      {fields.map(([key]) => <td key={key} className="px-3 py-2">{textValue(row?.[key]) ?? '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailAccordionSection>
        ))}
        {showFiles && (
          <DetailAccordionSection title="파일첨부" heading="h3">
            {pending ? <p className="text-muted-foreground">첨부 목록이 아직 수집되지 않았습니다. 재수집으로 조회할 수 있습니다.</p> : (
              <ul className="grid gap-2 text-sm">
                {files.map(({ filename, seq, downloadable }) => (
                  <li key={seq} className="wrap-anywhere">
                    {downloadable ? <a href={`${endpoint}/attachments/${seq}`} className={linkStyle}>{decodeHTMLStrict(filename)}</a>
                      : decodeHTMLStrict(filename)}
                  </li>
                ))}
              </ul>
            )}
          </DetailAccordionSection>
        )}
      </Accordion>
    </article>
  );
}

import { decodeHTMLStrict } from 'entities';
import Link from 'next/link';
import { noticePath } from '@/entities/notice/lib/notice-path';
import type { NoticeKey } from '@/entities/notice/model/types';
import { Accordion } from '@/shared/ui/accordion';
import { DetailAccordionSection } from '@/shared/ui/detail-accordion-section';
import { orderPlanAttachmentGroup, orderPlanFiles, type OrderPlan } from '../model/order-plan';

const groups = [
  {
    title: '발주계획 정보',
    fields: [
      ['oderPlanNo', '발주계획번호'], ['prcmBsneSeCdNm', '조달업무구분'],
      ['oderYymm', '발주예정년월'], ['releaseDt', '공개일시'],
      ['prcmMthoSeCdNm', '조달방법'], ['stdCtrtMthdCdNm', '계약방법'],
      ['scsbdMthdCdNm', '낙찰방법'], ['newLotmSeCdNm', '업무유형'],
      ['intbidTrgtYnNm', '국제입찰 대상'], ['ctrtDmndRcptNo', '계약요청접수번호'],
    ],
  },
  {
    title: '사업 및 예산 정보',
    fields: [
      ['bizNm', '사업명'], ['itemNm', '품명'], ['dtlsPrnm', '세부품명'],
      ['itemSpecCn', '규격'], ['itemUsagCn', '용도'],
      ['prchsPlanQty', '구매예정수량'], ['prchsUntNm', '구매단위'],
      ['prchsPrnmntAmt', '구매예정금액(원)'], ['bgtSumAmt', '예산합계(원)'],
      ['srvBgtAmt', '용역예산(원)'], ['oderSumAmt', '발주합계(원)'],
      ['cstrnPrdCn', '공사기간'], ['cstrnRmrkCn', '공사 비고'],
    ],
  },
  {
    title: '발주기관 및 담당자',
    fields: [
      ['oderInstNm', '발주기관'], ['tkcgDeptNm', '담당부서'],
      ['picNm', '담당자'], ['picTlphNo', '전화번호'], ['picRmrkCn', '담당자 비고'],
    ],
  },
] as const;

const numberFormat = new Intl.NumberFormat('ko-KR');

/**
 * 발주계획 상세, 첨부파일과 관련 공고 링크를 독립적인 본문으로 표시한다.
 * @param props 저장된 계획과 해당 계획을 참조하는 로컬 공고 목록.
 * @returns 페이지 또는 탭에 넣을 발주계획 본문.
 */
export function OrderPlanDetail({ plan, localNotices }: { plan: OrderPlan; localNotices: NoticeKey[] }) {
  const detail = plan.payload.dlOderPlanM;
  const title = [detail.bizNm, detail.itemNm].find((value): value is string =>
    typeof value === 'string' && Boolean(value.trim()));
  const notices = new Map(localNotices.map((notice) => [noticePath(notice), notice]));

  // 최초 수집 이후 등록된 공고도 로컬 공고 목록을 합쳐 표시한다.
  if (Array.isArray(detail.bidPbancList)) {
    for (const row of detail.bidPbancList) {
      const number = row?.bidPbancNo;
      const order = row?.bidPbancOrd;
      if (typeof number !== 'string' || !/^[A-Z0-9-]{1,30}$/.test(number) ||
          (typeof order !== 'string' && typeof order !== 'number') || !/^\d{1,3}$/.test(String(order))) continue;
      const notice = { number, revision: String(order).padStart(3, '0') };
      notices.set(noticePath(notice), notice);
    }
  }
  const specifications = Array.isArray(detail.bfSpecRegList)
    ? [...new Set(detail.bfSpecRegList.map((row) => row?.bfSpecRegNo)
      .filter((number): number is string => typeof number === 'string' && Boolean(number.trim())))]
    : [];
  const files = orderPlanFiles(plan);
  const attachmentsPending = Boolean(orderPlanAttachmentGroup(plan) && !plan.attachments);
  const showAttachments = files.length > 0 || attachmentsPending;
  const sections = [...groups.map(({ title }) => title), '관련 공고 정보'];
  if (showAttachments) sections.push('파일첨부');

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="grid gap-1">
        <h2 className="text-xl font-semibold">{title ? decodeHTMLStrict(title) : '발주계획 상세'}</h2>
        <p className="text-sm text-muted-foreground">{plan.number}</p>
      </header>
      <Accordion type="multiple" defaultValue={sections} className="min-w-0 border-t">
        {groups.map(({ title, fields }) => {
          const rows = fields.flatMap(([key, label]) => {
            const value = detail[key];
            if (typeof value === 'number') return [{ label, value: numberFormat.format(value) }];
            if (typeof value === 'string' && value.trim()) return [{ label, value: decodeHTMLStrict(value) }];
            return [];
          });
          if (!rows.length) return null;

          return (
            <DetailAccordionSection key={title} title={title} heading="h3">
              <dl className="grid gap-3 text-sm">
                {rows.map(({ label, value }) => (
                  <div key={label} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="wrap-anywhere whitespace-pre-wrap">{value}</dd>
                  </div>
                ))}
              </dl>
            </DetailAccordionSection>
          );
        })}
        <DetailAccordionSection title="관련 공고 정보" heading="h3">
          <div className="grid gap-3">
            {specifications.length > 0 && (
              <p className="text-sm">사전규격등록번호 {specifications.join(', ')}</p>
            )}
            {notices.size > 0 ? (
              <ul className="grid gap-2 text-sm">
                {[...notices].map(([href, { number, revision }]) => (
                  <li key={href}>
                    <Link href={href} className="text-primary underline underline-offset-2">{number} / {revision}</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">관련 입찰공고가 없습니다.</p>}
          </div>
        </DetailAccordionSection>
        {showAttachments && (
          <DetailAccordionSection title="파일첨부" heading="h3">
            {attachmentsPending ? (
              <p className="text-muted-foreground">첨부 목록이 아직 수집되지 않았습니다. 관련 공고를 다시 수집하면 첨부 목록을 조회합니다.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {files.map(({ filename, seq, downloadable }) => (
                  <li key={seq} className="wrap-anywhere">
                    {downloadable ? (
                      <a href={`/api/order-plans/${encodeURIComponent(plan.number)}/attachments/${seq}`} className="text-primary underline underline-offset-2">
                        {decodeHTMLStrict(filename)}
                      </a>
                    ) : decodeHTMLStrict(filename)}
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

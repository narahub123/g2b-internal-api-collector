import type { ReactNode } from "react";
import { decodeHTMLStrict } from "entities";
import Link from "next/link";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { orderPlanUnavailableMessage, orderPlanUnprocessableStatus } from "@/shared/config/g2b-order-plan";
import { Accordion } from "@/shared/ui/accordion";
import { NoticePostsSection } from "./NoticePostsSection";
import { AttachmentTable } from "@/shared/ui/g2b/AttachmentTable";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import { DetailTitle } from "@/shared/ui/g2b/DetailTitle";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { NoticeValue } from "./NoticeValue";
import { BaseAmountButton, BaseAmountDisclosure, BaseAmountPanel } from "./BaseAmountDisclosure";
import { BaseAmountDetail } from "./BaseAmountDetail";
import {
  getNoticeAttachmentFiles,
  getNoticeProposalFiles,
  getNoticeDisplay,
  relatedNoticeSectionTitle,
} from "../model/notice-display";
import { getPrivateNoticeAttachmentFiles, getPrivateNoticeDisplay } from "../model/private-notice-display";
import type { Notice } from "../model/types";
import { etcNoticeDetail, noticeDetail, privateNoticeResult } from "../model/notice-detail";
import type { NumberWithRevision } from "@/shared/lib/g2b/revision-route";

/**
 * 공고 상세의 표 데이터를 원본 열 순서대로 표시한다.
 * 기초금액공개 표의 상세보기 열은 표 아래 영역을 제어하는 버튼으로 표시한다.
 * @param props 표 제목, 열 이름과 행 데이터.
 * @returns 공고 상세 표.
 */
function NoticeTable({
  title,
  columns,
  rows,
  showEmpty = false,
}: {
  title: string;
  showEmpty?: boolean;
  columns: string[];
  rows: { value?: string; href?: string; colSpan?: number }[][];
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm" aria-label={title}>
        <thead className="bg-secondary">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 whitespace-nowrap"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showEmpty && !rows.length && (
            <tr><td colSpan={columns.length} className="p-3 text-center">데이터가 없음</td></tr>
          )}
          {rows.map((row, index) => (
            <tr key={index} className="border-t align-top">
              {row.map(({ value, href, colSpan }, column) => (
                <td key={columns[column]} colSpan={colSpan} className="min-w-20 px-3 py-2">
                  {title === "기초금액공개" &&
                  columns[column] === "상세보기" &&
                  value === "기초금액조회" ? (
                    <BaseAmountButton />
                  ) : value === undefined ? null : href ? (
                    <a
                      href={href}
                      className="wrap-anywhere text-primary underline underline-offset-2"
                    >
                      {decodeHTMLStrict(value)}
                    </a>
                  ) : (
                    <NoticeValue value={value ?? ""} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 공고번호와 차수로 나라장터의 공개 상세 링크를 만든다. */
function originalNoticeHref({ number, revision }: NumberWithRevision) {
  return `https://www.g2b.go.kr/link/PNPE027_01/single/?${new URLSearchParams({
    bidPbancNo: number,
    bidPbancOrd: revision,
  })}`;
}

/**
 * 수집한 입찰공고의 상세 정보, 관련 자료 및 원본 페이지 이동 기능을 표시한다.
 * 관련 자료의 주소가 없으면 원래 값을 표시하고, 제목 동작은 호출 화면이 제공할 때만 표시한다.
 * 발주계획번호 항목은 공고 원본의 값을 표시한다. 나라장터에서 미존재를 확인한 경우 번호 아래에 안내한다.
 * 관련공고는 저장된 상세로 연결하며, 미수집 공고는 나라장터 원본 상세로 연결한다.
 * @param props 공고 데이터, 저장된 발주계획번호, 연관 업무 링크와 제목 영역의 동작.
 * @returns 공고 상세 본문과 조건에 따른 관련 정보 및 첨부 목록.
 */
export async function NoticeDetail({
  notice,
  orderPlanNumber,
  links,
  renderActions,
}: {
  notice: Notice;
  orderPlanNumber?: string;
  links: {
    contractPath: (key: { number: string; revision: string }) => string | undefined | Promise<string | undefined>;
    contractRequestPath: (key: { number: string; revision: string }) => string | undefined | Promise<string | undefined>;
    noticePath: (key: NumberWithRevision) => string | undefined | Promise<string | undefined>;
    openingResultPath: (key: { number: string; revision: string }) => string | undefined | Promise<string | undefined>;
    orderPlanPath: (number: string) => string | undefined | Promise<string | undefined>;
    priorSpecPath: (number: string) => string | undefined | Promise<string | undefined>;
  };
  renderActions?: (input: { number: string; revision: string; methodCode: string }) => ReactNode;
}) {
  const contractLinks = [
    {
      label: "계약요청",
      links: await Promise.all((notice.contractRequests ?? []).map(async (key) => ({
        ...key,
        text: `${key.number} / ${key.revision}`,
        href: await links.contractRequestPath(key),
      }))),
    },
    {
      label: "계약현황",
      links: await Promise.all((notice.contracts ?? []).map(async (key) => ({
        ...key,
        text: `${key.number} / ${key.revision}`,
        href: await links.contractPath(key),
      }))),
    },
  ].filter(({ links }) => links.length > 0);
  const privateResult = privateNoticeResult(notice.payload);
  // 표의 원본 표시 조건에서 실제 개찰 링크에 사용되는 키만 조회한다.
  const openingPaths = new Map<string, string | undefined>();
  if (!privateResult) {
    const keys = new Map<string, NumberWithRevision>();
    getNoticeDisplay(notice.payload, notice.documents, (key) => {
      keys.set(JSON.stringify([key.number, key.revision]), key);
      return undefined;
    }, contractLinks.length > 0);
    await Promise.all(Array.from(keys, async ([id, key]) => {
      openingPaths.set(id, await links.openingResultPath(key));
    }));
  }
  const sections = privateResult ? [
    ...getPrivateNoticeDisplay(privateResult, notice.privatePosts, notice.privateCodeNames),
    { title: "파일첨부", columns: [], rows: [] },
  ] : getNoticeDisplay(
    notice.payload,
    notice.documents,
    (key) => openingPaths.get(JSON.stringify([key.number, key.revision])),
    contractLinks.length > 0,
  );
  const attachmentFiles = privateResult ? getPrivateNoticeAttachmentFiles(notice) : getNoticeAttachmentFiles(
    notice.payload,
    notice.documents,
  );
  const attachmentHrefBySeq = new Map(
    attachmentFiles.map((file) => [file.seq, file.href] as const),
  );
  const proposalFiles = getNoticeProposalFiles(
    notice.payload,
    notice.documents,
  );

  const proposalHrefBySeq = new Map(
    proposalFiles.map((file) => [file.seq, file.href] as const),
  );
  const { number, revision } = notice;
  const isEtc = Boolean(etcNoticeDetail(notice.payload));
  const detail = noticeDetail(notice.payload);
  const posts = isEtc ? undefined : notice.posts;
  const methodCode =
    typeof detail?.scsbdMthdCd === "string" ? detail.scsbdMthdCd : "";

  // 현재는 원본 페이지 존재 여부를 알려주는 공고 API 항목이 없어 번호와 차수로 링크를 생성해 항상 표시한다.
  // 향후 해당 정보가 수집되면 원본 페이지의 존재 여부에 따른 표시 조건을 적용할 수 있다.
  const originalHref = privateResult
    ? "https://www.g2b.go.kr/link/NNBB002_01/single/?" + new URLSearchParams({ bidPbancNo: number, bidPbancOrd: revision })
    : originalNoticeHref(notice);

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <DetailTitle
        headingLevel="h1"
        title={notice.title}
        subtitle={`${number} / ${revision}`}
        business={resolveG2bBusiness(detail?.prcmBsneSeCd, detail?.prcmBsneSeNm)}
        originalHref={originalHref}
        actions={renderActions?.({ number, revision, methodCode })}
      />
      {notice.documents?.unavailable?.map((kind) => (
        <p key={kind} className="text-sm text-muted-foreground">
          {kind === "proposal" && notice.documents?.proposalAccessDenied
            ? "나라장터에서 제안요청정보 조회를 거부했습니다(403)."
            : `${kind === "attachments" ? "파일첨부" : "제안요청정보"}를 가져오지 못했습니다.`}
          {notice.documents?.[kind] && " 이전에 수집한 목록을 표시합니다."}
        </p>
      ))}
      <Accordion
        type="multiple"
        defaultValue={[
          ...(posts?.entries.length ? ["공지사항"] : []),
          ...sections.map(({ title }) => title),
        ]}
        className="min-w-0 border-t"
      >
        {posts && (
          <NoticePostsSection
            posts={posts}
            number={number}
            revision={revision}
          />
        )}
        {sections.map(async (section) => {
          const { title } = section;
          const relatedLinks = title === relatedNoticeSectionTitle || (isEtc && title === "공고일반")
            ? [...contractLinks]
            : [];
          if ("relatedNotices" in section && section.relatedNotices?.length) {
            relatedLinks.unshift({
              label: "관련공고",
              links: await Promise.all(section.relatedNotices.map(async (key) => ({
                ...key,
                text: `${key.number}-${key.revision}`,
                href: await links.noticePath(key) ?? originalNoticeHref(key),
              }))),
            });
          }
          return "fields" in section ? (
            <DetailAccordionSection key={title} title={title}>
              <dl className="grid gap-4 text-sm">
                {section.fields.map(async ({ label, value, ...rest }, index) => {
                  const priorSpecNumber = label === "사전규격등록번호" ? g2bNumber(value) : undefined;
                  const orderPlanUnavailable = label === "발주계획번호" && notice.orderPlanStatus === orderPlanUnprocessableStatus;
                  const href = orderPlanUnavailable ? undefined : "href" in rest && typeof rest.href === "string" ? rest.href :
                    label === "발주계획번호" && orderPlanNumber
                      ? await links.orderPlanPath(orderPlanNumber)
                      : priorSpecNumber && await links.priorSpecPath(priorSpecNumber);
                  return (
                    <div
                      key={`${index}-${label ?? ""}`}
                      className={
                        label
                          ? "grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
                          : "min-w-0"
                      }
                    >
                      {label && (
                        <dt className="text-muted-foreground">{label}</dt>
                      )}
                      <dd>
                        {"details" in rest && Array.isArray(rest.details) ? (
                          <details>
                            <summary className="cursor-pointer underline underline-offset-2">{value}</summary>
                            <dl className="mt-2 grid gap-2">
                              {rest.details.map((item) => (
                                <div key={item.label}>
                                  <dt className="text-muted-foreground">{item.label}</dt>
                                  <dd>{item.href ? <a className="underline" href={item.href}>{item.value}</a> : <NoticeValue value={item.value} />}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        ) : href ? (
                          <Link
                            href={href}
                            className="text-primary underline underline-offset-2"
                          >
                            {value}
                          </Link>
                        ) : (
                          <>
                            {"items" in rest && Array.isArray(rest.items) ? (
                              <ul className="list-disc pl-5">
                                {rest.items.map((item, index) => (
                                  <li key={index}>{item}</li>
                                ))}
                              </ul>
                            ) : (
                              <NoticeValue value={value} />
                            )}
                            {label === "발주계획번호" && (
                              <p className="text-muted-foreground">
                                {orderPlanUnavailable ? orderPlanUnavailableMessage : "아직 수집된 발주계획이 없습니다."}
                              </p>
                            )}
                          </>
                        )}
                      </dd>
                    </div>
                  );
                })}
                {relatedLinks.map(({ label, links }) => (
                    <div
                      key={label}
                      className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>
                        <ul className="grid gap-1">
                          {links.map(({ number, revision, text, href }, index) => (
                            <li key={`${number}/${revision}/${index}`}>
                              {href ? (
                                <Link href={href} className="text-primary underline underline-offset-2">
                                  {text}
                                </Link>
                              ) : text}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
              </dl>
              {"nestedTable" in section && section.nestedTable && (
                <div className="mt-4 grid gap-2">
                  {"note" in section.nestedTable && typeof section.nestedTable.note === "string" ? (
                    <p className="text-sm text-muted-foreground">{section.nestedTable.note}</p>
                  ) : (
                    <h3 className="text-sm font-semibold">{section.nestedTable.title}</h3>
                  )}
                  <NoticeTable {...section.nestedTable} showEmpty={Boolean(privateResult)} />
                </div>
              )}
            </DetailAccordionSection>
          ) : (
            <DetailAccordionSection key={title} title={title}>
              {"note" in section && typeof section.note === "string" && (
                <p className="mb-2 text-sm text-muted-foreground">
                  {section.note}
                </p>
              )}
              {title === "파일첨부" ? (
                <AttachmentTable
                  files={attachmentFiles}
                  showDocumentType={!isEtc}
                  getDownloadHref={(file) => attachmentHrefBySeq.get(file.seq)}
                />
              ) : title === "제안요청정보" ? (
                <AttachmentTable
                  files={proposalFiles}
                  showDocumentType
                  showFileSize={false}
                  getDownloadHref={(file) => proposalHrefBySeq.get(file.seq)}
                />
              ) : title === "기초금액공개" && section.rows.length ? (
                <BaseAmountDisclosure key={JSON.stringify([number, revision])}>
                  <NoticeTable {...section} />
                  <BaseAmountPanel>
                    <BaseAmountDetail notice={notice} />
                  </BaseAmountPanel>
                </BaseAmountDisclosure>
              ) : (
                <NoticeTable {...section} showEmpty={Boolean(privateResult)} />
              )}
            </DetailAccordionSection>
          );
        })}
      </Accordion>
    </article>
  );
}

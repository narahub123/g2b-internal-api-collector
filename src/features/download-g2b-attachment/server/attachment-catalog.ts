import { createHash } from "node:crypto";
import { decodeHTMLStrict } from "entities";
import { getNoticeAttachmentFiles, getPublicProposalRows } from "@/entities/notice/model/notice-display";
import { etcNoticeDetail, noticeAttachmentGroup, privateNoticeResult } from "@/entities/notice/model/notice-detail";
import { noticePostRecord as record } from "@/entities/notice/model/notice-posts";
import { baseAmountAdjustmentFile } from "@/entities/notice/model/base-amount";
import { orderPlanAttachmentGroup } from "@/entities/order-plan/model/order-plan";
import { attachmentGroup, publicAttachmentFiles } from "@/shared/model/g2b/g2b-attachments";
import { getG2bRepository } from "@/server/g2b/repository";
import type { AttachmentJobFile, AttachmentOwner } from "@/server/g2b/repository/attachment-queue";
import { resolvePublicAttachmentDownload } from "./public-attachment-download";
import { resolveProposalDownload } from "./proposal-download";

type Scope = Parameters<typeof resolvePublicAttachmentDownload>[3];
type ListedFile = AttachmentJobFile & { resolve: (signal: AbortSignal) => Promise<URL | null> };

function nameParts(filename: string) {
  const name = decodeHTMLStrict(filename).normalize("NFC");
  const dot = name.lastIndexOf(".");
  return { stem: dot > 0 ? name.slice(0, dot) : name, pdf: dot > 0 && name.slice(dot + 1).toLowerCase() === "pdf" };
}

/** 같은 수집 건에서 확장자만 다른 비 PDF에 대응하는 모든 PDF를 찾는다. */
export function preferredPdfFiles<T extends { filename: string }>(file: T, files: readonly T[]) {
  const { stem, pdf } = nameParts(file.filename);
  if (pdf) return [];
  return files.filter((candidate) => {
    const parts = nameParts(candidate.filename);
    return parts.pdf && parts.stem === stem;
  });
}

/** 저장된 공개 목록 전체를 읽어 출처별 다운로드 규칙과 큐 식별자를 적용한다. */
export async function listAttachmentJobs(owner: AttachmentOwner, repository = getG2bRepository()) {
  const files = new Map<string, ListedFile>();
  function add(source: string, group: string, seq: string, filename: string, raw: Record<string, unknown>,
    resolve: ListedFile["resolve"]) {
    const path = typeof raw.atchFilePathNm === "string" ? raw.atchFilePathNm : undefined;
    const length = raw.fileSz == null || raw.fileSz === "" ? undefined : Number(raw.fileSz);
    const bytes = length !== undefined && Number.isSafeInteger(length) && length >= 0 ? length : undefined;
    const id = createHash("sha256").update(JSON.stringify([owner.section, owner.number, owner.revision,
      source, group, seq, path ?? null])).digest("hex");
    files.set(id, { id, owner, source, group, seq, filename, path, bytes, resolve });
  }
  function append(source: string, group: string | undefined, response: Record<string, unknown> | undefined,
    scope: Scope, onlySeq?: string) {
    if (!group) return;
    const rows = response?.dlUntyAtchFileL;
    if (!Array.isArray(rows)) return;
    for (const file of publicAttachmentFiles(group, response, scope)) {
      if (!file.downloadable || (onlySeq && onlySeq !== file.seq)) continue;
      const matches = rows.filter((row) => row?.untyAtchFileNo === group && String(row.atchFileSqno) === file.seq);
      if (matches.length !== 1) continue;
      const row = record(matches[0]);
      add(source, group, file.seq, file.filename, row, (signal) => resolvePublicAttachmentDownload(
        group, response, file.seq, scope, typeof row.atchFilePathNm === "string" ? row.atchFilePathNm : undefined, signal));
    }
  }

  if (owner.section === "order-plans") {
    const plan = await repository.findOrderPlan(owner.number);
    if (plan) append("order-plan", orderPlanAttachmentGroup(plan), plan.attachments, "order-plan");
  } else if (owner.section === "prior-specs") {
    const spec = await repository.findPriorSpec(owner.number);
    if (spec) append("prior-spec", attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo), spec.attachments, "prior-spec");
  } else {
    const notice = await repository.find(owner);
    if (!notice) return [];
    const group = noticeAttachmentGroup(notice.payload);
    const attachments = notice.documents?.attachments;
    const rows = attachments?.dlUntyAtchFileL;
    if (privateNoticeResult(notice.payload)) {
      append("notice", group, attachments, "private-notice");
    } else {
      for (const file of getNoticeAttachmentFiles(notice.payload, notice.documents)) {
        if (!file.href || !Array.isArray(rows)) continue;
        const matches = rows.filter((row) => String(row?.atchFileSqno) === file.seq);
        if (matches.length !== 1) continue;
        const row = record(matches[0]);
        const fileGroup = attachmentGroup(row.untyAtchFileNo) ?? group;
        if (fileGroup) add(etcNoticeDetail(notice.payload) ? "etc-notice" : "notice", fileGroup,
          file.seq, file.filename, row, async () => new URL(file.href!));
      }
    }
    for (const [source, posts] of [["notice-post", notice.posts], ["base-amount-post", notice.baseAmount?.posts]] as const) {
      for (const post of posts?.entries ?? []) {
        append(JSON.stringify([source, post.bbsNo, post.pstNo]),
          attachmentGroup(record(post.detail?.dlPstM).untyAtchFileNo), post.attachments, "notice-post");
      }
    }
    for (const [index, entry] of (notice.privatePosts?.details ?? []).entries()) {
      if (!entry) continue;
      const detail = record(record(entry.raw.result).noceMap);
      const postList = record(notice.privatePosts?.list.result).noceList;
      const post = record(Array.isArray(postList) ? postList[index] : undefined);
      append(JSON.stringify(["private-post", post.bbsNo ?? index, post.pstNo]),
        attachmentGroup(detail.untyAtchFileNo), entry.attachments, "notice-post");
    }
    const adjustment = notice.baseAmount?.adjustment;
    const target = notice.baseAmount?.detail && baseAmountAdjustmentFile(notice.baseAmount.detail);
    if (target && adjustment?.group === target.group && adjustment.seq === target.seq) {
      append("base-amount-adjustment", target.group, adjustment.response, "base-amount-adjustment", target.seq);
    }
    const proposals = notice.documents?.proposal?.dlUntyAtchFileL;
    for (const row of getPublicProposalRows(notice.payload, notice.documents)) {
      const fileGroup = attachmentGroup(row.fileNo);
      if (!fileGroup || !row.seq || !/^[1-9]\d*$/.test(row.seq) || typeof row.orgnlAtchFileNm !== "string") continue;
      const { seq, orgnlAtchFileNm: filename } = row;
      const raw = Array.isArray(proposals) ? proposals.find((item) => item?.rfpUntyAtchFileNo === fileGroup &&
        String(item.rfpAtchFileSqno) === seq) : undefined;
      if (raw?.dwnldPrmsYn === "N") continue;
      add("proposal", fileGroup, seq, filename, record(raw), (signal) => resolveProposalDownload(fileGroup, seq, filename,
        typeof raw?.atchFilePathNm === "string" ? raw.atchFilePathNm : undefined, signal));
    }
  }
  return [...files.values()];
}

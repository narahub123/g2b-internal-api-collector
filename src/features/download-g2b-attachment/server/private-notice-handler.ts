import type { NoticeKey } from "@/entities/notice";
import { postG2b } from "@/features/collect-g2b/api/request";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { attachmentGroup, publicAttachmentFiles } from "@/shared/model/g2b/g2b-attachments";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { noticeAttachmentGroup, privateNoticeResult } from "@/entities/notice/model/notice-detail";
import { getG2bRepository } from "@/server/g2b/repository";
import { maintenanceResponse } from "@/shared/api/g2b/g2b-maintenance";
import { resolvePublicAttachmentDownload } from "./public-attachment-download";

/**
 * 저장된 민간공고의 공개 첨부를 확인하고 나라장터 다운로드 주소로 이동한다.
 * @returns 공개 파일은 302, 순번 오류는 400, 파일 미확인은 404, 조회 실패는 502 또는 503.
 */
export async function downloadPrivateNoticeAttachment(
  request: Request,
  { params }: { params: Promise<NoticeKey & { seq: string }> },
) {
  const { number, revision, seq } = await params;
  if (!/^[1-9]\d*$/.test(seq)) return new Response(null, { status: 400 });

  const notice = await getG2bRepository().find({ number, revision });
  if (!notice || !privateNoticeResult(notice.payload)) return new Response(null, { status: 404 });
  try {
    const query = new URL(request.url).searchParams;
    const post = query.get("post");
    if (post !== null && !/^\d+$/.test(post)) return new Response(null, { status: 400 });
    const entry = post === null ? undefined : notice.privatePosts?.details[Number(post)];
    if (post !== null && !entry) return new Response(null, { status: 404 });
    const scope = entry ? "notice-post" : "private-notice";
    const group = entry ? attachmentGroup(noticePostRecord(noticePostRecord(entry.raw.result).noceMap).untyAtchFileNo) :
      noticeAttachmentGroup(notice.payload);
    const attachments = entry ? entry.attachments : notice.documents?.attachments;
    let url: URL | null;
    if (query.get("preview") === "1") {
      if (!group || !publicAttachmentFiles(group, attachments, scope).some((file) => file.seq === seq))
        return new Response(null, { status: 404 });
      const session = await createG2bSession();
      const response = await postG2b("/fs/fsc/fsca/atchFileDocViewer.do", "smbDownAtflGrpDetlM", {
        dlDownAtflGrpDetlM: { untyAtchFileNo: group, atchFileSqno: seq },
      }, session);
      const target = response.result?.viewUrlPath;
      url = typeof target === "string" && target ? new URL(target, "https://www.g2b.go.kr") : null;
      if (url?.origin !== "https://www.g2b.go.kr") url = null;
    } else {
      url = await resolvePublicAttachmentDownload(group, attachments, seq, scope);
    }
    return url
      ? new Response(null, { status: 302, headers: { Location: url.href, "Cache-Control": "no-store" } })
      : new Response(null, { status: 404 });
  } catch (error) {
    return maintenanceResponse(error) ?? new Response(null, { status: 502 });
  }
}

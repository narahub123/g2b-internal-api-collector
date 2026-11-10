import type { NoticeKey } from "@/entities/notice";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { getNoticeRepository } from "@/entities/notice/server";
import { resolvePublicAttachmentDownload } from "@/shared/api/public-attachment-download";
import { attachmentGroup } from "@/shared/model/g2b-attachments";

/** 저장된 공지에 속한 공개 첨부파일만 나라장터 다운로드로 연결한다. */
export async function GET(
  request: Request,
  { params }: { params: Promise<NoticeKey> },
) {
  const { searchParams } = new URL(request.url);
  const bbsNo = searchParams.get("bbsNo");
  const pstNo = searchParams.get("pstNo");
  const seq = searchParams.get("seq");
  if (!bbsNo || !pstNo || !seq || !/^[1-9]\d*$/.test(seq)) {
    return Response.json(
      { error: "게시물과 첨부파일 번호를 확인하세요." },
      { status: 400 },
    );
  }

  const notice = await getNoticeRepository().find(await params);
  const post = notice?.posts?.entries.find(
    (entry) => entry.bbsNo === bbsNo && entry.pstNo === pstNo,
  );
  const group = attachmentGroup(
    noticePostRecord(post?.detail?.dlPstM).untyAtchFileNo,
  );
  try {
    const url = await resolvePublicAttachmentDownload(
      group,
      post?.attachments,
      seq,
      "notice-post",
    );
    if (url)
      return new Response(null, {
        status: 302,
        headers: { Location: url.href, "Cache-Control": "no-store" },
      });
    return Response.json(
      { error: "다운로드 가능한 게시물 첨부파일을 찾을 수 없습니다." },
      { status: 404 },
    );
  } catch {
    return Response.json(
      { error: "나라장터 다운로드 정보를 가져오지 못했습니다." },
      { status: 502 },
    );
  }
}

import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';
import type { NoticeKey } from "@/entities/notice";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { getG2bRepository } from "@/server/g2b/repository";
import { resolvePublicAttachmentDownload } from "@/features/download-g2b-attachment/server/public-attachment-download";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";

/**
 * 공고에 저장된 게시판과 게시글의 공개 첨부만 최신 메타데이터를 확인해 다운로드로 연결한다.
 * @param request 쿼리에 게시판 번호, 게시글 번호, 양의 첨부 순번을 전달한다. 기초금액 공지는 source에 base-amount를 지정한다.
 * @returns 검증된 파일은 302, 입력 오류는 400, 대상 미확인은 404, 점검은 503, 그 외 조회 실패는 502를 반환한다.
 * @throws 공고 조회에 필요한 저장소 접근이 실패한 경우.
 */
export async function downloadNoticePost(
  request: Request,
  { params }: { params: Promise<NoticeKey> },
) {
  const { searchParams } = new URL(request.url);
  const bbsNo = searchParams.get("bbsNo");
  const pstNo = searchParams.get("pstNo");
  const seq = searchParams.get("seq");
  const source = searchParams.get("source");
  if (!bbsNo || !pstNo || !seq || !/^[1-9]\d*$/.test(seq) || (source !== null && source !== "base-amount")) {
    return Response.json(
      { error: "게시물과 첨부파일 번호를 확인하세요." },
      { status: 400 },
    );
  }

  const notice = await getG2bRepository().find(await params);
  const posts = source === "base-amount" ? notice?.baseAmount?.posts : notice?.posts;
  const post = posts?.entries.find((entry) => entry.bbsNo === bbsNo && entry.pstNo === pstNo);
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
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json(
      { error: "나라장터 다운로드 정보를 가져오지 못했습니다." },
      { status: 502 },
    );
  }
}

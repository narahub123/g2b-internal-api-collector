import { baseAmountAdjustmentFile } from "@/entities/notice/model/base-amount";
import type { NoticeKey } from "@/entities/notice";
import { getG2bRepository } from "@/server/g2b/repository";
import { maintenanceResponse } from "@/shared/api/g2b/g2b-maintenance";
import { resolvePublicAttachmentDownload } from "./public-attachment-download";

/**
 * 공고의 기초금액 상세가 지정한 조정사유서만 공개 여부를 다시 확인해 다운로드한다.
 * @returns 공개 파일은 리다이렉트로 연결하고, 자료 미확인·점검·조회 오류는 HTTP 상태로 구분한다.
 * @throws 공고 저장소 조회가 실패한 경우.
 */
export async function downloadBaseAmountAdjustment(
  _request: Request,
  { params }: { params: Promise<NoticeKey> },
) {
  const notice = await getG2bRepository().find(await params);
  const detail = notice?.baseAmount?.detail;
  const attachment = notice?.baseAmount?.adjustment;
  const target = detail && baseAmountAdjustmentFile(detail);
  try {
    if (target && attachment && target.group === attachment.group && target.seq === attachment.seq) {
      const url = await resolvePublicAttachmentDownload(
        target.group, attachment.response, target.seq, "base-amount-adjustment",
      );
      if (url) return new Response(null, {
        status: 302,
        headers: { Location: url.href, "Cache-Control": "no-store" },
      });
    }
    return Response.json({ error: "공개된 조사금액 조정사유서를 찾을 수 없습니다." }, { status: 404 });
  } catch (error) {
    return maintenanceResponse(error) ??
      Response.json({ error: "나라장터 다운로드 정보를 가져오지 못했습니다." }, { status: 502 });
  }
}

import { getNoticeRepository } from '@/entities/notice/server';
import { resolvePublicAttachmentDownload } from '@/shared/api/public-attachment-download';
import { attachmentGroup } from '@/shared/model/g2b-attachments';

export async function GET(_request: Request, { params }: { params: Promise<{ number: string; seq: string }> }) {
  const { number, seq } = await params;
  const spec = getNoticeRepository().findPriorSpec(number);
  if (!spec) return Response.json({ error: '사전규격을 찾을 수 없습니다.' }, { status: 404 });

  try {
    const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
    const url = await resolvePublicAttachmentDownload(group, spec.attachments, seq, 'prior-spec');
    if (url) return new Response(null, { status: 302, headers: { Location: url.href, 'Cache-Control': 'no-store' } });
    return Response.json({ error: '다운로드 가능한 사전규격 첨부파일을 찾을 수 없습니다.' }, { status: 404 });
  } catch {
    return Response.json({ error: '나라장터 다운로드 정보를 가져오지 못했습니다.' }, { status: 502 });
  }
}

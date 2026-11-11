import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';
import { getG2bRepository } from '@/server/g2b/repository';
import { resolvePublicAttachmentDownload } from '@/features/download-g2b-attachment/server/public-attachment-download';
import { attachmentGroup } from '@/shared/model/g2b/g2b-attachments';

/**
 * 저장된 사전규격의 공개 첨부 목록을 기준으로 파일 순번과 나라장터 메타데이터를 검증한다.
 * @returns 검증된 파일은 302, 대상 미확인은 404, 점검은 503, 그 외 메타데이터 조회 실패는 502를 반환한다.
 * @throws 다운로드 대상 조회에 필요한 저장소 접근이 실패한 경우.
 */
export async function downloadPriorSpecAttachment(_request: Request, { params }: { params: Promise<{ number: string; seq: string }> }) {
  const { number, seq } = await params;
  const spec = getG2bRepository().findPriorSpec(number);
  if (!spec) return Response.json({ error: '사전규격을 찾을 수 없습니다.' }, { status: 404 });

  try {
    const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
    const url = await resolvePublicAttachmentDownload(group, spec.attachments, seq, 'prior-spec');
    if (url) return new Response(null, { status: 302, headers: { Location: url.href, 'Cache-Control': 'no-store' } });
    return Response.json({ error: '다운로드 가능한 사전규격 첨부파일을 찾을 수 없습니다.' }, { status: 404 });
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터 다운로드 정보를 가져오지 못했습니다.' }, { status: 502 });
  }
}

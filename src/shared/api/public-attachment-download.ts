import { g2bDownloadUrl } from '@/shared/api/g2b-download';
import { attachmentSources, publicAttachmentFiles } from '@/shared/model/g2b-attachments';

const origin = 'https://www.g2b.go.kr';

/**
 * 공개 첨부의 메타데이터를 검증해 나라장터 다운로드 주소를 반환한다.
 * @param group 상세 응답의 통합첨부파일번호.
 * @param attachments 저장된 첨부 목록.
 * @param seq 첨부 그룹 내 파일 순번.
 * @param scope 첨부를 소유한 상세 자료 유형.
 * @returns 다운로드 주소. 공개 파일이 아니거나 응답에서 파일을 확인할 수 없으면 null.
 * @throws 나라장터 메타데이터 요청이 실패하거나 응답 형식이 올바르지 않을 때.
 */
export async function resolvePublicAttachmentDownload(
  group: string | undefined, attachments: Record<string, unknown> | undefined,
  seq: string, scope: 'order-plan' | 'prior-spec',
): Promise<URL | null> {
  const savedFile = publicAttachmentFiles(group, attachments).find((file) => file.seq === seq && file.downloadable);
  if (!group || !savedFile) return null;
  const source = attachmentSources[scope];

  // 화면용 첨부 목록에는 경로가 생략되어 다운로드에 필요한 메타데이터를 따로 조회한다.
  const response = await fetch(`${origin}/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dlUntyAtchFileM: {
        ...source, untyAtchFileNo: group, bsnePath: source.bsnePath.toLowerCase(),
        bsneClsfCd: savedFile.businessCode, webPathUse: 'N', viewMode: 'view',
      },
    }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('첨부 메타데이터를 가져오지 못했습니다.');
  const result = await response.json();
  if (String(result?.ErrorCode) !== '0' || !Array.isArray(result.dlUntyAtchFileL)) {
    throw new Error('첨부 메타데이터 응답이 올바르지 않습니다.');
  }
  const matches = result.dlUntyAtchFileL.filter((file) => file?.untyAtchFileNo === group && String(file.atchFileSqno) === seq);
  if (matches.length !== 1) return null;

  const file = matches[0];
  const path = file.atchFilePathNm;
  if (file.scrnIndtYn === 'N' || file.dwnldPrmsYn === 'N' || file.orgnlAtchFileNm !== savedFile.filename ||
      typeof path !== 'string' || !/^\/data\/Attachfiles\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) {
    return null;
  }

  // 나라장터 공개 다운로드 핸들러의 k21에는 첨부 그룹과 순번을 함께 전달한다.
  const fields = { kc: 'c11', k01: '1', k05: '0', k26: path, k31: savedFile.filename, k21: `${group},${seq}` };
  return g2bDownloadUrl(fields);
}

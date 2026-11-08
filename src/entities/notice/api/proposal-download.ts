import { g2bDownloadUrl } from '@/shared/api/g2b-download';

const origin = 'https://www.g2b.go.kr';
const fileNoPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * 공개 제안요청 문서의 메타데이터를 확인하고 원본 다운로드 주소를 구성한다.
 * @param fileNo 저장된 공개 문서의 첨부 그룹 ID.
 * @param seq 첨부 그룹 내 양의 파일 순번.
 * @param filename 제안요청 API에서 받은 원본 파일명.
 * @returns 문서 식별자와 파일명이 일치할 때 다운로드 URL, 조회 결과가 일치하지 않으면 null.
 * @throws 나라장터 메타데이터 요청이 실패했을 때.
 */
export async function resolveProposalDownload(fileNo: string, seq: string, filename: string): Promise<URL | null> {
  if (!fileNoPattern.test(fileNo) || !/^[1-9]\d*$/.test(seq) || /[\x00-\x1f\x7f]/.test(filename)) return null;

  const response = await fetch(`${origin}/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dlUntyAtchFileM: {
        untyAtchFileNo: fileNo, bsnePath: 'prpc', bsneClsfCd: '업130026',
        tblNm: 'DMND_RFP_ATCH_FILE', colNm: 'RFP_UNTY_ATCH_FILE_NO', webPathUse: 'N', viewMode: 'view',
      },
    }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('제안요청 첨부 메타데이터를 가져오지 못했습니다.');
  const result = await response.json();
  if (String(result?.ErrorCode) !== '0' || !Array.isArray(result.dlUntyAtchFileL)) {
    throw new Error('제안요청 첨부 메타데이터 응답이 올바르지 않습니다.');
  }

  const matches = result.dlUntyAtchFileL.filter((file) => file?.untyAtchFileNo === fileNo && String(file.atchFileSqno) === seq);
  if (matches.length !== 1) return null;
  const file = matches[0];
  const path = file.atchFilePathNm;
  if (file.scrnIndtYn === 'N' || file.dwnldPrmsYn === 'N' || file.orgnlAtchFileNm !== filename ||
      typeof path !== 'string' || !/^\/data\/Attachfiles\/prpc\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) {
    return null;
  }

  // RAON 핸들러는 파일 식별자 외에 서버가 반환한 경로와 파일명을 k00에 요구한다.
  const fields = { kc: 'c11', k01: '1', k12: fileNo, k05: '0', k26: path, k31: filename, k21: fileNo, fileSeq: seq };
  return g2bDownloadUrl(fields, { fileNo, fileSeq: seq });
}

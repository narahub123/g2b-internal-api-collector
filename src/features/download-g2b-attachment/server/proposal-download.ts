import { g2bDownloadUrl } from '@/shared/api/g2b/g2b-download';
import { readG2bResponse } from '@/shared/api/g2b/g2b-maintenance';

const origin = 'https://www.g2b.go.kr';
// 다운로드 메타데이터 API에는 UUID 형식으로 저장된 첨부 그룹만 전달한다.
const fileNoPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * 공개 제안요청 문서의 메타데이터를 확인하고 원본 다운로드 주소를 구성한다.
 * @param fileNo 저장된 공개 문서의 첨부 그룹 ID.
 * @param seq 첨부 그룹 내 양의 파일 순번.
 * @param filename 제안요청 API에서 받은 원본 파일명.
 * @param expectedPath 저장된 경로가 있는 경우 다운로드 시 경로 변경을 확인한다.
 * @param signal 첨부 작업 실행권이 상실되면 메타데이터 요청도 중단한다.
 * @returns 문서 식별자와 파일명이 일치할 때 다운로드 URL, 조회 결과가 일치하지 않으면 null.
 * @throws 메타데이터 응답이 점검 화면이거나 요청 또는 응답 검증에 실패한 경우.
 */
export async function resolveProposalDownload(fileNo: string, seq: string, filename: string,
  expectedPath?: string, signal?: AbortSignal): Promise<URL | null> {
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
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  });
  const body = await readG2bResponse(response);
  if (!response.ok) throw new Error('제안요청 첨부 메타데이터를 가져오지 못했습니다.');
  const result = JSON.parse(body);
  if (String(result?.ErrorCode) !== '0' || !Array.isArray(result.dlUntyAtchFileL)) {
    throw new Error('제안요청 첨부 메타데이터 응답이 올바르지 않습니다.');
  }

  const matches = result.dlUntyAtchFileL.filter((file) => file?.untyAtchFileNo === fileNo && String(file.atchFileSqno) === seq);
  if (matches.length !== 1) return null;
  const file = matches[0];
  const path = file.atchFilePathNm;
  if (file.scrnIndtYn === 'N' || file.dwnldPrmsYn === 'N' || file.orgnlAtchFileNm !== filename ||
      typeof path !== 'string' || (expectedPath !== undefined && path !== expectedPath) ||
      !/^\/data\/Attachfiles\/prpc\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) {
    return null;
  }

  // RAON 핸들러는 파일 식별자 외에 서버가 반환한 경로와 파일명을 k00에 요구한다.
  const fields = { kc: 'c11', k01: '1', k12: fileNo, k05: '0', k26: path, k31: filename, k21: fileNo, fileSeq: seq };
  return g2bDownloadUrl(fields, { fileNo, fileSeq: seq });
}

import { collectionError, collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";
import { attachmentSources } from "@/shared/model/g2b/g2b-attachments";
import { postG2b, type G2bRequest } from "./request";

/**
 * 문서 목록 응답의 필수 배열을 확인해 잘못된 응답을 저장 단계로 전달하지 않는다.
 *
 * @param path 문서 목록 조회 경로.
 * @param submission 요청 submission 식별자.
 * @param input 문서 조회 조건.
 * @param request 선택적 세션 요청 함수.
 * @returns 첨부 목록 배열이 확인된 API 원본 응답.
 * @throws 첨부 목록 형식이 올바르지 않거나 요청이 실패한 경우.
 */
export async function collectDocumentList(
  path: string,
  submission: string,
  input: object,
  request?: G2bRequest,
) {
  const result = await postG2b(path, submission, input, request).catch((error: unknown) => {
    throw collectionError(error, { step: "첨부 문서 조회" });
  });
  if (!Array.isArray(result.dlUntyAtchFileL)) {
    throw collectionError(collectionValidationError(
      `나라장터 문서 목록 응답 형식이 올바르지 않습니다: ${path}`,
      "dlUntyAtchFileL",
    ), { step: "첨부 문서 응답 검증", request: { path, submissionId: submission } });
  }
  return result;
}

/**
 * 공고·발주계획·사전규격별 첨부 출처 설정을 적용해 공통 첨부 목록을 요청한다.
 *
 * @param untyAtchFileNo 첨부파일 그룹 번호.
 * @param scope 첨부 출처를 구분하는 업무 유형.
 * @param request 선택적 세션 요청 함수.
 * @returns 첨부 목록 조회 결과.
 */
export function collectAttachments(
  untyAtchFileNo: string,
  scope: keyof typeof attachmentSources,
  request?: G2bRequest,
) {
  return collectDocumentList(
    "/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do",
    "sbmInsertAtflGrp",
    {
      dlUntyAtchFileM: {
        ...attachmentSources[scope],
        untyAtchFileNo,
        atchFileSqnos: "",
        bsneClsfCd: scope === "notice-post" ? "업130026" : "업130020",
        webPathUse: "N",
        isScanEnabled: false,
        imgUrl: "",
        atchFileKndCds: "",
        ignoreAtchFileKndCds: "",
        kbrdrIds: "",
        kuploadId: "",
        viewMode: "view",
        ignoreScrnIndtYn: "",
      },
    },
    request,
  );
}

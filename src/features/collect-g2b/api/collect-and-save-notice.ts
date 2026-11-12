import { getG2bRepository } from "@/server/g2b/repository";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { etcNoticeDetail, noticeAttachmentGroup } from "@/entities/notice/model/notice-detail";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import type { CollectNoticeInput } from "../model/input";
import { trackCollectionAttempt } from "./collection-attempt";
import { collectOnce } from "./collect-once";
import { collectNotice } from "./notices";

/**
 * 공고와 관련 자료를 조회하고 이전 자료로 보완한 뒤 저장한다.
 * 동일한 공고의 동시 요청은 먼저 시작한 요청의 낙찰방법으로 조회부터 저장까지 공유한다.
 * @param input 검증을 통과한 공고번호, 공고차수와 낙찰방법 코드.
 * @returns 공고 저장이 끝난 뒤 해당 요청에서 처리한 개찰차수별 결과.
 * @throws 점검, 공고 조회 또는 저장에 실패한 경우.
 */
export async function collectAndSaveNotice(input: CollectNoticeInput) {
  const { number, revision, methodCode } = input;
  return collectOnce(JSON.stringify(["notice", number, revision]), true, () =>
    trackCollectionAttempt({ section: "notices", ...input }, async () => {
      const { notice, openingReport } = await collectNotice({ number, revision }, methodCode);
      const repository = getG2bRepository();
      const documents = notice.documents;
      const isEtc = Boolean(etcNoticeDetail(notice.payload));
      if (documents?.unavailable?.length || notice.contractRequests === undefined || notice.contracts === undefined ||
          (!isEtc && (!notice.posts || notice.posts.entries.some((post) => !post.body ||
            (!post.attachments && attachmentGroup(noticePostRecord(post.detail?.dlPstM).untyAtchFileNo)))))) {
        // 일시적인 문서 조회 실패 때문에 이전에 저장한 원본 목록을 잃지 않도록 한다.
        const previous = await repository.find({ number, revision });
        if (documents) {
          for (const kind of documents.unavailable ?? []) {
            if (isEtc && kind === "attachments") {
              const group = noticeAttachmentGroup(notice.payload);
              if (!previous || !group || group !== noticeAttachmentGroup(previous.payload)) continue;
            }
            documents[kind] = previous?.documents?.[kind];
          }
        }
        notice.contractRequests ??= previous?.contractRequests;
        notice.contracts ??= previous?.contracts;
        if (!isEtc && !notice.posts) {
          notice.posts = previous?.posts;
        } else if (notice.posts) {
          for (const post of notice.posts.entries) {
            const saved = previous?.posts?.entries.find(({ bbsNo, pstNo }) => bbsNo === post.bbsNo && pstNo === post.pstNo);
            if (!saved) continue;
            post.detail ??= saved.detail;
            post.body ??= saved.body;
            // 다른 첨부 그룹으로 변경된 공지에는 예전 파일을 표시하지 않는다.
            const group = attachmentGroup(noticePostRecord(post.detail?.dlPstM).untyAtchFileNo);
            const savedGroup = attachmentGroup(noticePostRecord(saved.detail?.dlPstM).untyAtchFileNo);
            if (group && group === savedGroup) post.attachments ??= saved.attachments;
          }
        }
      }
      await repository.save(notice);
      return openingReport;
    }),
  );
}

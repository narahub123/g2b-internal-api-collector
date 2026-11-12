import { getG2bRepository } from "@/server/g2b/repository";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { etcNoticeDetail, noticeAttachmentGroup } from "@/entities/notice/model/notice-detail";
import { getRelatedNoticeKeys } from "@/entities/notice/model/notice-display";
import type { Notice, NoticeKey } from "@/entities/notice/model/types";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import type { CollectNoticeInput } from "../model/input";
import { trackCollectionAttempt, trackCollectionLookup } from "./collection-attempt";
import { collectOnce } from "./collect-once";
import { collectNotice } from "./notices";
import { collectionError, collectionStep } from "@/shared/api/g2b/collection-diagnostic";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";

// 직접 수집과 자동 수집이 같은 번호·차수의 단건 작업을 공유한다.
function noticeCollectionKey({ number, revision }: NoticeKey) {
  return JSON.stringify(["notice", number, revision]);
}

function saveCollectedNotice(input: CollectNoticeInput, usePrevious: boolean) {
  const { number, revision, methodCode } = input;
  return trackCollectionAttempt({ section: "notices", ...input }, async (recordFailure) => {
    const { notice, openingReport } = await collectNotice({ number, revision }, methodCode, recordFailure);
    const repository = getG2bRepository();
    const documents = notice.documents;
    const isEtc = Boolean(etcNoticeDetail(notice.payload));
    const missingPosts = !isEtc && (!notice.posts || notice.posts.entries.some((post) => !post.body ||
      (!post.attachments && attachmentGroup(noticePostRecord(post.detail?.dlPstM).untyAtchFileNo))));
    if (usePrevious && (documents?.unavailable?.length || missingPosts ||
        notice.contractRequests === undefined || notice.contracts === undefined)) {
      // 일시적인 문서 조회 실패 때문에 이전에 저장한 원본 목록을 잃지 않도록 한다.
      const previous = collectionStep("SQLite 이전 공고 조회", () =>
        repository.findUsableNotice(input));
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
    await repository.save(notice).catch((error: unknown) => {
      throw collectionError(error, { step: "SQLite 공고 저장" });
    });
    return { notice, openingReport };
  });
}

function collectRequestedNotice(input: CollectNoticeInput) {
  return collectOnce(noticeCollectionKey(input), true, () => saveCollectedNotice(input, true));
}

/**
 * 요청한 공고 한 건과 부가 자료를 저장하고 개찰차수별 수집 결과를 반환한다.
 * @param input 검증을 통과한 공고번호, 차수와 낙찰방법 코드.
 * @throws 나라장터 점검 또는 단건 공고 조회·저장에 실패한 경우.
 */
export async function collectAndSaveNotice(input: CollectNoticeInput) {
  return (await collectRequestedNotice(input)).openingReport;
}

/**
 * 요청한 공고를 저장한 뒤 상세 응답으로 연결된 공고를 순서대로 탐색한다.
 * 정상 저장 건은 조회 결과를 재사용하고, 미저장 또는 손상 건만 단건 수집을 시도한다.
 * 관련공고 실패는 개별 이력에 남기며 점검이 확인되면 이후 탐색을 중단한다.
 * @throws 최초 요청 공고의 수집이나 저장에 실패한 경우.
 */
export async function collectNoticeWithRelated(input: CollectNoticeInput) {
  const { notice } = await collectRequestedNotice(input);
  const visited = new Set([noticeCollectionKey(input)]);
  const queue = getRelatedNoticeKeys(notice.payload);

  // 다른 요청도 상대 공고의 단건 결과를 받을 수 있도록 탐색은 수집 잠금 밖에서 진행한다.
  for (const key of queue) {
    const collectionKey = noticeCollectionKey(key);
    if (visited.has(collectionKey)) continue;
    visited.add(collectionKey);
    const relatedInput = { ...key, methodCode: "" };
    try {
      const result = await collectOnce<{ notice: Notice }>(collectionKey, false, async () => {
        const saved = await trackCollectionLookup({ section: "notices", ...relatedInput }, "관련공고", () =>
          getG2bRepository().findUsableNotice(key));
        if (saved) return { notice: saved };
        return saveCollectedNotice(relatedInput, false);
      });
      for (const reference of getRelatedNoticeKeys(result.notice.payload)) queue.push(reference);
    } catch (error) {
      if (findMaintenance(error)) break;
    }
  }
}

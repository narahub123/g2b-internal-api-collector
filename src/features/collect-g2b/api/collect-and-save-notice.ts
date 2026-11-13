import { getG2bRepository } from "@/server/g2b/repository";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { etcNoticeDetail, noticeAttachmentGroup } from "@/entities/notice/model/notice-detail";
import { getRelatedNoticeKeys } from "@/entities/notice/model/notice-display";
import type { Notice } from "@/entities/notice/model/types";
import { getNoticeOrderPlanNumber, orderPlanNoticeReferences } from "@/entities/order-plan/model/order-plan";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import { trackCollectionAttempt, trackCollectionLookup } from "./collection-attempt";
import type { NoticeJob, NoticeJobOutcome, NoticeQueueInput } from "@/server/g2b/repository/notice-queue-types";
import { collectNotice, NoticeCollectionDeferred } from "./notices";
import { collectionError, collectionStep, describeCollectionError } from "@/shared/api/g2b/collection-diagnostic";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";

function saveCollectedNotice(input: NoticeQueueInput, jobId: number, onPartialFailure: (error: unknown) => void) {
  const { number, revision, methodCode } = input;
  return trackCollectionAttempt({ section: "notices", number, revision, methodCode }, async (recordFailure) => {
    const { notice, openingReport } = await collectNotice({ number, revision }, methodCode, recordFailure);
    const repository = getG2bRepository();
    const documents = notice.documents;
    const isEtc = Boolean(etcNoticeDetail(notice.payload));
    const missingPosts = !isEtc && (!notice.posts || notice.posts.entries.some((post) => !post.body ||
      (!post.attachments && attachmentGroup(noticePostRecord(post.detail?.dlPstM).untyAtchFileNo))));
    if (documents?.unavailable?.length || missingPosts ||
        notice.contractRequests === undefined || notice.contracts === undefined) {
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
    if (input.opening && !openingReport.targetRevisions.length) {
      recordFailure(new Error("조회할 개찰결과 상세를 찾을 수 없습니다."));
    }
    return { notice, openingReport };
  }, { id: jobId, onPartialFailure });
}

/**
 * 저장된 발주계획의 원본 공고 참조를 일반 탐색 입력으로 변환한다.
 * @throws 저장된 발주계획을 읽지 못한 경우.
 */
export function relatedPlanInputs(number: string): NoticeQueueInput[] {
  const plan = getG2bRepository().findOrderPlan(number);
  return plan ? orderPlanNoticeReferences(plan).map((key) => ({ ...key, methodCode: "" })) : [];
}

function relatedInputs(notice: Notice): NoticeQueueInput[] {
  const references = getRelatedNoticeKeys(notice.payload).map((key) => ({ ...key, methodCode: "" }));
  const planNumber = notice.orderPlanNumber ?? getNoticeOrderPlanNumber(notice.payload);
  return planNumber ? [...references, ...relatedPlanInputs(planNumber)] : references;
}

/**
 * 선점된 공고 하나를 처리한다. 일반 탐색의 첫 시도는 저장된 정상 상세를 재사용한다.
 * 부분 실패에도 저장된 자료와 개찰차수 보고서를 보존하여 같은 작업에서 다시 시도할 수 있게 한다.
 */
export async function executeNoticeJob({ id, input, force, executions }: NoticeJob): Promise<NoticeJobOutcome> {
  const repository = getG2bRepository();
  let partial: unknown;
  try {
    const target = { section: "notices" as const, number: input.number, revision: input.revision, methodCode: input.methodCode };
    const saved = !force && executions === 1 ? await trackCollectionLookup(target, "관련공고", () => repository.findUsableNotice(input), id) : null;
    const collected = saved ? undefined : await saveCollectedNotice(input, id, (error) => { partial = error; });
    const notice = saved ?? collected.notice;
    const report = collected?.openingReport;
    const result = {
      noticeSaved: true,
      title: notice.title,
      targetRevisions: report?.targetRevisions ?? [],
      succeededRevisions: report?.succeededRevisions ?? [],
      failedRevisions: report?.failures.map(({ revision }) => revision) ?? [],
    };
    const related = relatedInputs(notice);
    const openingFailure = report?.failures[0]?.error;
    if (partial || openingFailure || (input.opening && !result.targetRevisions.length)) {
      const error = partial || openingFailure ? describeCollectionError(partial ?? openingFailure).message : "조회할 개찰결과 상세를 찾을 수 없습니다.";
      return { kind: "failure", error, result, related };
    }
    return { kind: "success", result, related };
  } catch (error) {
    const maintenance = findMaintenance(error);
    const report = error instanceof NoticeCollectionDeferred ? error.openingReport : undefined;
    const result = {
      noticeSaved: Boolean(await repository.find(input).catch(() => null)),
      targetRevisions: report?.targetRevisions ?? [],
      succeededRevisions: report?.succeededRevisions ?? [],
      failedRevisions: report?.failures.map(({ revision }) => revision) ?? [],
    };
    return maintenance ? { kind: "maintenance", error: maintenance.message, result } :
      { kind: "failure", error: describeCollectionError(error).message, result };
  }
}

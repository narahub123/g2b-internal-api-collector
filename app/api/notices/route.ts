import { getNoticeRepository } from '@/entities/notice/server';
import { collectNotice, parseCollectNoticeInput } from '@/features/collect-notice/server';
import { noticePostRecord } from '@/entities/notice/model/notice-posts';
import { attachmentGroup } from '@/shared/model/g2b-attachments';

export async function GET() {
  return Response.json(await getNoticeRepository().list());
}

export async function POST(request: Request) {
  const input = parseCollectNoticeInput(await request.json().catch(() => null));
  if (!input) {
    return Response.json({ error: '공고번호, 세 자리 차수, 낙찰방법 코드를 확인하세요.' }, { status: 400 });
  }

  const { number, revision, methodCode } = input;
  const notice = await collectNotice({ number, revision }, methodCode).catch(() => null);
  if (!notice) {
    return Response.json({ error: '나라장터에서 공고 상세를 가져오지 못했습니다.' }, { status: 502 });
  }
  const repository = getNoticeRepository();
  const documents = notice.documents;
  if (documents?.unavailable?.length || notice.contractRequests === undefined || notice.contracts === undefined ||
      !notice.posts || notice.posts.entries.some((post) => !post.body ||
        (!post.attachments && attachmentGroup(noticePostRecord(post.detail?.dlPstM).untyAtchFileNo)))) {
    // 일시적인 문서 조회 실패 때문에 이전에 저장한 원본 목록을 잃지 않도록 한다.
    const previous = await repository.find({ number, revision });
    if (documents) {
      for (const kind of documents.unavailable ?? []) {
        documents[kind] = previous?.documents?.[kind];
      }
    }
    notice.contractRequests ??= previous?.contractRequests;
    notice.contracts ??= previous?.contracts;
    if (!notice.posts) {
      notice.posts = previous?.posts;
    } else {
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
  return Response.json({ number, revision });
}

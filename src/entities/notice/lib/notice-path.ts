import type { NoticeKey } from "../model/types";

/** 공고번호와 차수를 URL 세그먼트로 인코딩해 관리자 공고 상세로 연결한다. */
export function noticePath({ number, revision }: NoticeKey) {
  return `/admin/notices/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}

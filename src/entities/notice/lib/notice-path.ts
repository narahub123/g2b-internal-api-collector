import type { NoticeKey } from '../model/types';

export function noticePath({ number, revision }: NoticeKey) {
  return `/notices/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}

import { openNoticeRepository } from './api/sqlite-notices';
import type { NoticeRepository } from './model/types';

export { NoticeDetail } from './ui/NoticeDetail';
export { resolveProposalDownload } from './api/proposal-download';
export { getPublicProposalRows } from './model/notice-display';

let repository: NoticeRepository | undefined;

export function getNoticeRepository() {
  return repository ??= openNoticeRepository();
}

import { openNoticeRepository } from './api/sqlite-notices';
import type { NoticeRepository } from './model/types';

export { NoticeDetail } from './ui/NoticeDetail';

let repository: NoticeRepository | undefined;

export function getNoticeRepository() {
  return repository ??= openNoticeRepository();
}

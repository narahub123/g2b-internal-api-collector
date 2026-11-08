import { decodeHTMLStrict } from 'entities';
import sanitizeHtml from 'sanitize-html';

const htmlTag = /<\/?[a-z][\w:-]*(?:\s[^<>]*?)?\s*\/?>/i;
const escapedLessThan = /&(?:lt|#0*60|#x0*3c);/i;

export function renderNoticeHtml(value: string): string | null {
  const html = htmlTag.test(value) || !escapedLessThan.test(value)
    ? value
    : decodeHTMLStrict(value);
  return htmlTag.test(html) ? sanitizeHtml(html, { allowProtocolRelative: false }) : null;
}

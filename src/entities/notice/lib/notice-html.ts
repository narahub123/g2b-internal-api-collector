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

export function* findNoticeHtml(value: unknown, path = ''): Generator<{ path: string; html: string }> {
  if (typeof value === 'string') {
    const html = renderNoticeHtml(value);
    if (html?.trim()) yield { path, html };
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = Array.isArray(value) ? `${path}[${key}]` : [path, key].filter(Boolean).join('.');
      yield* findNoticeHtml(child, childPath);
    }
  }
}

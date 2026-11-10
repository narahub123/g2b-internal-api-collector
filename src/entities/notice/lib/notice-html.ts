import { decodeHTMLStrict } from "entities";
import sanitizeHtml from "sanitize-html";

// HTML 태그가 포함된 문자열인지 판별한다.
const htmlTag = /<\/?[a-z][\w:-]*(?:\s[^<>]*?)?\s*\/?>/i;

// HTML 엔티티로 인코딩된 태그 시작 문자(<)를 감지한다.
const escapedLessThan = /&(?:lt|#0*60|#x0*3c);/i;

// 줄바꿈이나 공백 문자만 들어 있는 빈 p 요소를 찾는다.
const emptyParagraph =
  /<p(?:\s[^>]*)?>\s*(?:(?:<br\s*\/?>|&nbsp;|&#160;)\s*)*<\/p>/gi;

export function renderNoticeHtml(value: string): string | null {
  // 인코딩된 HTML인 경우에만 엔티티를 디코딩한다.
  const html =
    htmlTag.test(value) || !escapedLessThan.test(value)
      ? value
      : decodeHTMLStrict(value);

  // HTML 태그가 없다면 일반 문자열로 간주해 HTML 렌더링을 건너뛴다.
  if (!htmlTag.test(html)) {
    return null;
  }

  // 위험한 HTML을 정제하면서 필요한 텍스트 서식만 제한적으로 허용한다.
  const sanitized = sanitizeHtml(html, {
    // 프로토콜 상대 URL(//example.com)을 허용하지 않는다.
    allowProtocolRelative: false,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      // 모든 허용 태그에서 style 속성을 정제 규칙에 따라 사용할 수 있게 한다.
      "*": ["style"],
    },
    allowedStyles: {
      // 원본 문서의 정렬·굵기·크기·줄 높이에 필요한 CSS 값만 허용한다.
      "*": {
        "text-align": [/^(left|right|center|justify)$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
        "line-height": [/^\d+(\.\d+)?(px|pt|em|rem|%)?$/],
      },
    },
  });

  // DB에 저장된 원본은 유지하고, 화면에 출력할 때만 빈 문단을 제거한다.
  return sanitized.replace(emptyParagraph, "");
}

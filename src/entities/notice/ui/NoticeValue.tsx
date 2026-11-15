import { decodeHTMLStrict } from "entities";
import { renderNoticeHtml } from "../lib/notice-html";

/**
 * 공고 필드값을 HTML 표시 정책에 따라 출력한다.
 * HTML로 처리할 수 없는 값은 엔티티를 디코딩한 일반 텍스트로 표시한다.
 * @param props 수집된 원본 필드값.
 * @returns HTML 또는 일반 텍스트로 표시한 필드값.
 */
export function NoticeValue({ value, inline = false }: { value: string; inline?: boolean }) {
  const Container = inline ? "span" : "div";
  const html = renderNoticeHtml(value);
  const className =
    "wrap-anywhere overflow-x-auto whitespace-pre-wrap [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5";
  return html === null ? (
    <Container className={className}>{decodeHTMLStrict(value)}</Container>
  ) : (
    <Container className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

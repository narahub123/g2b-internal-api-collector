/** 좌표 기준 정렬이 어려울 때 PDF.js의 줄 끝과 단어 경계를 유지한다. */
export function pdfText(items: { str?: string; hasEOL?: boolean }[]) {
  let text = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    if (text && !/\s$/.test(text) && item.str && !/^\s/.test(item.str)) text += " ";
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text.replaceAll("\u0000", "").trimEnd();
}

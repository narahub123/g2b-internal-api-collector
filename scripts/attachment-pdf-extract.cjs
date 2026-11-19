const { readFile, stat } = require("node:fs/promises");
const { dirname, join } = require("node:path");

// 자식도 기존 워커와 같은 로더를 등록해 프로젝트의 TypeScript 추출 모듈을 읽는다.
require("./register-project-typescript.cjs");
const { pathRectangles, readingOrderText } = require("../src/features/download-g2b-attachment/server/pdf/reading-order");
const { PDF_EXTRACTOR_VERSION, PDF_MAX_BYTES, PDF_MAX_PAGES } = require("../src/shared/model/g2b/attachment-pdf");
// 표준 글꼴과 문자 매핑은 작업 디렉터리 대신 설치된 PDF.js 패키지에서 찾는다.
const root = dirname(require.resolve("pdfjs-dist/package.json"));

/** 같은 원본을 다시 받아도 해결되지 않는 형식·크기·페이지 제한 위반을 표시한다. */
class InvalidPdf extends Error {}

/**
 * 부모가 다운로드한 임시 원본의 페이지별 텍스트를 화면 읽기 순서로 추출한다.
 * @param {string} path 크기 검증을 거쳐 읽을 임시 PDF 경로.
 * @returns {Promise<import("../src/shared/model/g2b/attachment-pdf").PdfExtraction>} 페이지 순서와 추출 버전을 포함한 결과.
 * @throws 파일 조회나 파싱에 실패하거나, PDF가 처리 제한을 넘으면 오류를 전달한다.
 */
async function extract(path) {
  const file = await stat(path);
  if (!file.isFile() || file.size > PDF_MAX_BYTES) {
    throw new InvalidPdf("PDF가 50 MiB 제한을 초과했거나 일반 파일이 아닙니다.");
  }
  const bytes = await readFile(path);
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw new InvalidPdf("다운로드 응답이 PDF 형식이 아닙니다.");
  }
  // CommonJS 진입점에서 PDF.js의 ESM 배포본을 비동기로 불러온다.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // 실제 파서와 저장 결과에 붙는 버전이 다르면 해시 캐시를 잘못 재사용할 수 있다.
  if (!PDF_EXTRACTOR_VERSION.startsWith(`${pdfjs.version} / `)) {
    throw new Error("PDF.js 버전과 추출기 버전 설정이 일치하지 않습니다.");
  }
  const loading = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    standardFontDataUrl: join(root, "standard_fonts").replaceAll("\\", "/") + "/",
    cMapUrl: join(root, "cmaps").replaceAll("\\", "/") + "/",
    cMapPacked: true,
  });
  try {
    const document = await loading.promise;
    if (document.numPages > PDF_MAX_PAGES) throw new InvalidPdf(`PDF가 ${PDF_MAX_PAGES}페이지 제한을 초과했습니다.`);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        // 표의 경계를 읽을 수 없을 때도 텍스트 추출 결과는 보존한다.
        const operations = await page.getOperatorList().catch(() => ({ fnArray: [], argsArray: [] }));
        const cells = pathRectangles(operations, viewport.transform, pdfjs.OPS);
        // 좌표로 순서를 복원하고 잘못 짝지어진 UTF-16 코드 단위는 저장 전에 대체한다.
        const text = readingOrderText(content.items.filter((item) => "str" in item), viewport.transform, cells).toWellFormed();
        pages.push({ pageNumber, text });
      } finally {
        // 페이지별 리소스를 반환해 많은 페이지를 읽을 때 사용량이 누적되는 것을 줄인다.
        page.cleanup();
      }
    }
    return { version: PDF_EXTRACTOR_VERSION, pages, characterCount: pages.reduce((total, page) => total + page.text.length, 0) };
  } finally {
    await loading.destroy();
  }
}

/** 성공 결과 또는 재시도 가능 여부를 IPC로 한 번 전달하고 전송 완료 후 연결을 닫는다. */
async function main() {
  let message;
  try {
    message = { result: await extract(process.argv[2]) };
  } catch (error) {
    const invalid = error.name === "InvalidPDFException";
    const encrypted = error.name === "PasswordException";
    message = {
      permanent: invalid || encrypted || error instanceof InvalidPdf,
      error: encrypted ? "암호화된 PDF는 처리할 수 없습니다."
        : invalid ? "PDF가 손상되었거나 읽을 수 없는 형식입니다." : error.message,
    };
  }
  process.send(message, () => process.disconnect());
}

void main();

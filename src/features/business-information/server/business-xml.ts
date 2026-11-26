import { SaxesParser } from "saxes";

/** 응답의 위치별 태그와 업무 원문을 유지하는 XML 요소다. */
type XmlElement = {
  /** 이름이 같은 요소도 응답 순서대로 보존하는 자식 목록. */
  children: { name: string; element: XmlElement }[];
  /** 엔티티와 CDATA를 해석한 표시 전 원문. */
  text: string;
};

/**
 * 신뢰할 수 없는 공공 API 응답을 요소 트리로 읽는다.
 * @param body 외부 API XML 응답 본문.
 * @returns 문서의 최상위 요소를 담은 노드.
 * @throws 문법이 잘못됐거나 DTD 또는 비정상적으로 깊은 문서인 경우.
 */
export function readBusinessXml(body: string) {
  // 문서 루트를 찾을 수 있게 가상 최상위 노드를 준비한다.
  const root: XmlElement = { children: [], text: "" };
  // 열린 태그의 조상을 추적하여 서로 다른 경로의 동명 요소를 구분한다.
  const stack = [root];
  // 외부 엔티티 해석 없이 표준 XML 이벤트를 사용한다.
  const parser = new SaxesParser();
  /**
   * 업무 응답에 필요 없는 DTD를 만나면 해석을 중단한다.
   * @throws DTD가 있는 외부 응답이라는 정책 오류.
   */
  function rejectDoctype() {
    // 문서에 선언한 엔티티나 외부 리소스는 응답 계약에 포함되지 않는다.
    throw new Error("외부 API XML에 지원하지 않는 문서 형식이 있습니다.");
  }
  /**
   * 시작 태그를 부모에 연결하고 이후 텍스트의 대상으로 지정한다.
   * @param tag XML 파서가 확인한 시작 태그.
   * @throws 응답 명세의 구조에 필요한 깊이 한도를 초과한 경우.
   */
  function openTag(tag: { name: string }) {
    // 응답 계약의 구조를 크게 벗어나는 중첩은 저장하기 전에 중단한다.
    if (stack.length >= 32) throw new Error("외부 API XML 구조가 너무 깊습니다.");
    // 빈 요소와 누락 요소를 구분할 수 있게 시작 태그마다 노드를 생성한다.
    const element: XmlElement = { children: [], text: "" };
    // 문서 순서대로 같은 이름의 결과 행도 모두 연결한다.
    stack.at(-1)!.children.push({ name: tag.name, element });
    // 다음 텍스트나 자식 태그가 이 노드에 붙도록 한다.
    stack.push(element);
  }
  /**
   * 일반 텍스트와 CDATA를 열린 요소의 원문에 이어 붙인다.
   * @param text XML에서 해석한 텍스트 조각.
   */
  function appendText(text: string) {
    // 업무 값의 앞뒤 공백과 빈 문자열을 그대로 유지한다.
    stack.at(-1)!.text += text;
  }
  /** 닫는 태그 이후의 내용이 부모 요소에 속하도록 위치를 복원한다. */
  function closeTag() {
    // 문법상 일치하는 시작 태그는 파서가 확인한다.
    stack.pop();
  }

  // 문서 구조와 원문 값을 만드는 이벤트를 연결한다.
  parser.on("doctype", rejectDoctype);
  parser.on("opentag", openTag);
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", closeTag);
  // 닫히지 않은 요소 등 문서 오류도 close 단계에서 검출한다.
  parser.write(body).close();
  // 공급자 응답 또는 공통 오류 응답을 해석할 수 있도록 최상위 노드를 반환한다.
  return root;
}

/**
 * 현재 요소의 지정한 직계 자식을 찾아 응답의 구조를 따른다.
 * @param parent 상위 요소. 누락된 경로는 undefined.
 * @param name 찾을 태그의 이름.
 * @returns 해당 직계 요소 또는 undefined.
 */
export function xmlChild(parent: XmlElement | undefined, name: string) {
  // 다른 분기의 같은 이름을 응답 필드로 오인하지 않도록 직계 자식만 확인한다.
  return parent?.children.find((child) => child.name === name)?.element;
}

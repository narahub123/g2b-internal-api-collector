import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import { formatG2bDisplayDateTime, formatG2bDisplayNumber } from "@/shared/lib/g2b/g2b-display-format";
import { baseAmountLayout, type BaseAmountLayoutNode } from "./base-amount-layout";
import { applyBaseAmountRules, formatKoreanAmount } from "./base-amount-rules";
import { mergeNoticePosts, noticePostRecord, type NoticePosts } from "./notice-posts";

type RawResponse = Record<string, unknown>;
type Scalar = string | number | boolean;
type BaseAmountPart = "detail" | "posts" | "adjustment";

/** 공고와 함께 저장하는 기초금액 원본 및 부가 수집 상태. */
export type NoticeBaseAmount = {
  detail?: RawResponse;
  posts?: NoticePosts;
  adjustment?: { group: string; seq: string; response: RawResponse };
  unavailable?: BaseAmountPart[];
  retained?: BaseAmountPart[];
};

export type BaseAmountNode = Pick<BaseAmountLayoutNode, "kind" | "id" | "colSpan" | "rowSpan"> & {
  text?: string;
  children?: BaseAmountNode[];
};

/** 원본 공고 상세에서 기초금액조회 버튼을 제공하는 행을 반환한다. */
export function noticeBaseAmountRows(payload: RawResponse): RawResponse[] {
  const detail = noticePostRecord(payload.dmItemMap);
  return detail.pnprDcsnMthoCd !== "예050001" && Array.isArray(payload.dmItemBaseAmtList)
    ? payload.dmItemBaseAmtList
    : [];
}

function scalarMap(raw: RawResponse) {
  return new Map<string, Scalar>(
    Object.entries(raw).filter((entry): entry is [string, Scalar] =>
      typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
    ),
  );
}

function baseAmountResult(response: RawResponse) {
  const result = noticePostRecord(response.result);
  return { result, detail: { ...result, ...noticePostRecord(result.bidInfo), ...noticePostRecord(result.baseEstiPrice) } };
}

/**
 * 나라장터 데이터 바인딩 순서와 업무별 표시 조건을 적용해 화면 모델을 만든다.
 * 응답 원본을 유지하고, 상위 영역이 숨겨진 자식은 값이 있어도 제외한다.
 */
export function getBaseAmountDisplay(response: RawResponse) {
  const { result, detail } = baseAmountResult(response);
  const rows = Array.isArray(result.listBaseEstiPrice) ? result.listBaseEstiPrice.map(noticePostRecord) : [];
  const maps = {
    dlBsisAmtRM: scalarMap(detail),
    dlBsisAmtM: new Map<string, Scalar>(),
    dlBsisAinfoM: scalarMap(noticePostRecord(result.labrrPrtcAndCnstrcSafeAmtInfo)),
    dlRsvPrceBsislM: new Map<string, Scalar>(),
  };
  const { visibility, text, standardFilename } = applyBaseAmountRules(
    maps.dlBsisAmtRM, maps.dlBsisAmtM, maps.dlBsisAinfoM, maps.dlRsvPrceBsislM, rows,
  );
  const visibleIds = new Set<string>();

  function resolve(layout: BaseAmountLayoutNode[]): BaseAmountNode[] {
    return layout.flatMap(({ kind, id, hidden, binding, digits, colSpan, rowSpan, text: label, children }) => {
      if ((id ? (visibility.get(id) ?? !hidden) : !hidden) === false) return [];
      if (id) visibleIds.add(id);
      let value = id && text.has(id) ? text.get(id) : label;
      if (binding) {
        const [map, field] = binding.split(".");
        value = String(maps[map as keyof typeof maps]?.get(field) ?? "");
        if (digits !== undefined) value = formatG2bDisplayNumber(value, digits);
        else if (/(?:Dt|Dtm)$/.test(field)) value = formatG2bDisplayDateTime(value);
      }
      return [{ kind, id, colSpan, rowSpan, text: value, children: children && resolve(children) }];
    });
  }

  return {
    nodes: resolve(baseAmountLayout),
    visibleIds,
    standardFilename,
    rows: rows.map(({ bidClsfNo, bsamt, rmrkCn }) => {
      const amount = String(bsamt ?? "");
      return {
        bidClsfNo: String(bidClsfNo ?? ""),
        bsamt: formatG2bDisplayNumber(amount, 3),
        bsamtKor: formatKoreanAmount(amount.replace(/,/g, "")),
        rmrkCn: String(rmrkCn ?? ""),
      };
    }),
  };
}

/**
 * 원본에서 조정사유서 버튼이 보이고 그룹·순번이 유효하면 조회 대상을 반환한다.
 * 차세대 전환 플래그가 적용된 기존 공고는 00차수에 저장된 그룹을 사용한다.
 */
export function baseAmountAdjustmentFile(response: RawResponse, display = getBaseAmountDisplay(response)) {
  if (!display.visibleIds.has("btnInvsAmtAdjsSmrs")) return;
  const { detail } = baseAmountResult(response);
  const group = attachmentGroup(detail.isNewG2bOpenDateOver === "Y"
    ? detail.oldPbancSpecUntyAtchFileNo : detail.pbancSpecUntyAtchFileNo);
  const seq = String(detail.adjsSmrsAtchFileSqno ?? "");
  if (group && /^[1-9]\d*$/.test(seq)) return { group, seq };
}

/** 재수집에 실패한 자료만 복구하고, 첨부는 원본에서 여전히 같은 그룹·순번을 지정할 때 유지한다. */
export function mergeNoticeBaseAmount(current: NoticeBaseAmount, previous: NoticeBaseAmount): NoticeBaseAmount {
  const retained: BaseAmountPart[] = [];
  const result = { ...current };
  if (current.unavailable?.includes("detail") && previous.detail) {
    result.detail = previous.detail;
    result.adjustment = previous.adjustment;
    retained.push("detail");
  } else if (current.unavailable?.includes("adjustment") && current.detail && previous.adjustment) {
    const target = baseAmountAdjustmentFile(current.detail);
    if (target?.group === previous.adjustment.group && target.seq === previous.adjustment.seq) {
      result.adjustment = previous.adjustment;
      retained.push("adjustment");
    }
  }
  result.posts = mergeNoticePosts(current.posts, previous.posts);
  if (result.posts && (!current.posts || result.posts.entries.some((post, index) => {
    const fresh = current.posts.entries[index];
    return post.detail !== fresh.detail || post.body !== fresh.body || post.attachments !== fresh.attachments;
  }))) retained.push("posts");
  return { ...result, retained };
}

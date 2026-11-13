import { setTimeout as wait } from "node:timers/promises";
import { decodeHTML } from "entities";
import { collectionError } from "@/shared/api/g2b/collection-diagnostic";
import { readG2bResponse } from "@/shared/api/g2b/g2b-maintenance";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { parseCollectNoticeInput, type CollectNoticeInput } from "../model/input";

// 입찰공고 목록 화면에서 관찰한 내부 API 주소와 요청 식별자다. 상세 조회 API와 구분한다.
const origin = "https://www.g2b.go.kr";
const path = "/pn/pnp/pnpe/BidPbac/selectBidPbacScrollTypeList.do";
const submissionId = "mf_wfm_container_tacBidPbancLst_contents_tab2_body_sbmPbancBidPbancLst";
// 150건은 한 번에 요청하는 행 수이며 전체 기간 수집 건수의 상한이 아니다.
const pageSize = 150;
// 페이지 요청별 타임아웃과 통신 오류 재시도 간격. 최초 요청을 포함해 최대 세 번 시도한다.
const timeoutMs = 15_000;
const retryDelays = [2000, 5000];
// 날짜별 탐색에서는 현지 달력 값을 UTC의 고정 길이 일자로 계산해 호스트 시간대 영향을 피한다.
const dayMs = 86_400_000;

// 화면에서 전체 업무를 선택할 때 전달하는 코드이며 공고종류는 빈값으로 보낸다.
const searchConditions = {
  // 목록 요청은 사용하지 않는 검색 필드도 화면과 같은 빈값으로 전달한다.
  untyBidPbancNo: "",
  bidPbancNo: "",
  bidPbancOrd: "",
  prcmBsneUntyNoOrd: "",
  bidPbancNm: "",
  pbancPstgDt: "",
  ldocNoVal: "",
  bidPrspPrce: "",
  ctrtDmndRcptNo: "",
  dmstcOvrsSeCd: "",
  ctrtTyCd: "",
  bidCtrtMthdCd: "",
  scsbdMthdCd: "",
  minBidPrspPrce: "",
  maxBidPrspPrce: "",
  untyGrpGb: "",
  dmstNm: "",
  pbancPicNm: "",
  odnLmtLgdngCd: "",
  odnLmtLgdngNm: "",
  intpCd: "",
  intpNm: "",
  dtlsPrnmNo: "",
  dtlsPrnmNm: "",
  slprRcptDdlnYn: "",
  lcrtTyCd: "",
  isMas: "",
  isElpdt: "",
  oderInstUntyGrpNo: "",
  instSearchRangeYn: "",
  esdacYn: "",
  brcoOrgnCd: "",
  deptOrgnCd: "",
  isShop: "",
  cangParmVal: "",
  prcmBsneSeCd: "0000 조070001 조070002 조070003 조070004 조070005 민079999",
  pbancKndCd: "",
  bsneAllYn: "Y",
  frcpYn: "Y",
  rsrvYn: "Y",
  laseYn: "Y",
  infoSysCd: "정010029",
  contxtSeCd: "콘010006",
  bidDateType: "R",
  srchTy: "0",
  currentPage: "",
  recordCountPerPage: String(pageSize),
};

// 목록 화면을 식별하는 헤더는 상세 API의 메뉴 정보와 다르다.
const headers = {
  "Content-Type": "application/json;charset=UTF-8",
  Accept: "application/json",
  Origin: origin,
  "Menu-Info": '{"menuNo":"01175","menuCangVal":"PNPE001_01","bsneClsfCd":"%EC%97%85130026","scrnNo":"00941"}',
  "Target-Id": "btnS0004",
  submissionid: submissionId,
};

/** 기간 수집 큐에 전달할 공고 식별자와 목록에서 확보한 제목. */
export type NoticePeriodTarget = CollectNoticeInput & { title: string };

// 테스트에서 세션 생성과 대기 시간을 주입할 수 있도록 외부 부수 효과를 분리한다.
type Dependencies = {
  createSession: typeof createG2bSession;
  wait: (ms: number) => Promise<void>;
};

/**
 * 한국 현지 시각 문자열을 분 단위 비교에 사용할 숫자로 변환한다.
 * UTC 파싱은 시간대 변환이 아니라 달력 값의 유효성과 순서를 검증하기 위한 것이다.
 * @param value 초와 시간대 표기가 없는 YYYY-MM-DDTHH:mm 문자열.
 * @returns 유효한 날짜의 타임스탬프 또는 형식·날짜가 잘못된 경우 NaN.
 */
function minuteValue(value: string): number {
  // 한국 현지 시각의 달력 값끼리 비교한다. 호스트 시간대의 영향을 피하기 위해 UTC로 계산한다.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value + ":00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value
    ? timestamp : NaN;
}

/**
 * 외부 요청 전에 한국 현지 시각의 분 형식과 시작·종료 순서를 검증한다.
 * @throws 존재하지 않는 날짜·시각이거나 종료가 시작보다 이르면 RangeError.
 */
export function validateNoticePeriod(startMinute: string, endMinute: string) {
  const start = minuteValue(startMinute);
  const end = minuteValue(endMinute);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new RangeError("수집 시작·종료 시각을 올바른 순서와 분 단위 형식으로 입력해 주세요.");
  }
  return { start, end };
}

/**
 * 서버가 보낸 Retry-After를 재요청 대기 시간으로 해석한다.
 * 초 단위 정수와 HTTP 날짜 형식을 허용하고 지난 날짜는 즉시 재시도하도록 0으로 맞춘다.
 * @param value Retry-After 헤더 원문.
 * @returns 유효한 지연 시간(ms), 값이 없거나 해석할 수 없으면 undefined.
 */
function retryAfterMs(value: string | null): number | undefined {
  if (!value) return;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  if (Number.isFinite(delay)) return Math.max(0, delay);
}

/**
 * 긴 Retry-After도 Node 타이머의 최대 지연 한도를 넘지 않도록 분할해 대기한다.
 * @param delay 전체 대기 시간(ms).
 * @param sleep 실제 대기 함수. 테스트에서는 대체할 수 있다.
 * @returns 요청한 대기가 끝나면 완료된다.
 * @throws 대기 함수에서 발생한 오류를 호출자에게 전달한다.
 */
async function waitForRetry(delay: number, sleep: Dependencies["wait"]) {
  // Node 타이머의 최대 지연을 넘으면 1ms로 줄어들므로 긴 Retry-After는 나눠 기다린다.
  const maxDelay = 2_147_483_647;
  while (delay > maxDelay) {
    await sleep(maxDelay);
    delay -= maxDelay;
  }
  await sleep(delay);
}

/**
 * 목록의 한 행을 기존 상세 수집 입력과 게시 시각으로 변환한다.
 * 두 자리 차수는 세 자리로 맞추고, 게시 시각 뒤의 마감 시각은 필터에 사용하지 않는다.
 * @param value 내부 목록 API가 반환한 개별 행.
 * @returns 정규화한 대상, 게시 분, 공고번호·차수 중복 판정 키.
 * @throws 공고 식별자·낙찰방법 코드·게시 시각을 검증할 수 없는 경우.
 */
function parseRow(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("입찰공고 목록 행이 올바르지 않습니다.");
  const row = value as Record<string, unknown>;
  // 목록의 두 자리 차수도 기존 상세·큐에서 사용하는 세 자리 공고 키로 맞춘다.
  const revision = typeof row.bidPbancUntyOrd === "string" && /^\d{1,3}$/.test(row.bidPbancUntyOrd)
    ? row.bidPbancUntyOrd.padStart(3, "0") : undefined;
  const input = parseCollectNoticeInput({
    number: row.bidPbancUntyNo,
    revision,
    methodCode: row.scsbdMthdCd ?? "",
  });
  if (!input) throw new Error("입찰공고 목록의 공고번호, 차수 또는 낙찰방법 코드가 올바르지 않습니다.");
  // 게시 시각은 줄바꿈 앞에 있으며 뒤에 표시되는 접수 마감 시각은 기간 비교에 쓰지 않는다.
  const posted = typeof row.pbancPstgDt === "string" ? decodeHTML(row.pbancPstgDt).trim() : "";
  const match = /^(\d{4}\/\d{2}\/\d{2}) (\d{2}:\d{2})(?=$|\s|<)/.exec(posted);
  const minute = match ? minuteValue(match[1].replaceAll("/", "-") + "T" + match[2]) : NaN;
  if (!Number.isFinite(minute)) throw new Error("입찰공고 목록의 게시 시각이 올바르지 않습니다.");
  const title = typeof row.bidPbancNm === "string" ? row.bidPbancNm : "";
  return { target: { ...input, title }, minute, key: `${input.number}/${input.revision}` };
}

/**
 * 한국 시간 기준 시작·종료 분을 포함하는 입찰공고 대상 목록을 확정한다.
 * 일자별 목록을 끝까지 조회하고 게시 시각으로 필터링한 뒤 번호·차수 중복을 제거한다.
 * 익명 세션과 조회 요청만 사용하며 큐 등록이나 저장은 호출자가 수행한다.
 * @param startMinute 시작 시각. 한국 현지 시각을 YYYY-MM-DDTHH:mm 형식으로 전달한다.
 * @param endMinute 종료 시각. 시작 시각과 같은 분도 허용한다.
 * @param dependencies 세션 생성과 재시도 대기를 대체할 때만 지정한다.
 * @returns 모든 페이지가 검증된 공고 목록. 정상적으로 대상이 없으면 빈 배열.
 * @throws 잘못된 기간, 반복 페이지, 응답 검증 실패 또는 복구하지 못한 통신 오류. 점검 오류는 별도로 전파한다.
 */
export async function listNoticePeriodTargets(
  startMinute: string,
  endMinute: string,
  dependencies: Dependencies = { createSession: createG2bSession, wait },
): Promise<NoticePeriodTarget[]> {
  const { start, end } = validateNoticePeriod(startMinute, endMinute);

  let request: Awaited<ReturnType<typeof createG2bSession>> | undefined;
  const targets = new Map<string, NoticePeriodTarget>();

  /**
   * 지정한 날짜의 한 페이지를 익명 세션으로 요청하고 업무 응답을 검증한다.
   * 통신·429·5xx는 최대 세 번 시도하며 -801 세션 오류는 세션 재발급 후 한 번 더 요청한다.
   * @param date 서버의 날짜 단위 검색값(YYYYMMDD).
   * @param startIndex 1부터 시작하는 목록 행 위치.
   * @returns 업무 코드 0으로 검증된 원본 목록 행.
   * @throws 재시도 소진, 점검 응답, 권한 오류 또는 응답 형식 오류를 호출자에게 전달한다.
   */
  async function readPage(date: string, startIndex: number): Promise<unknown[]> {
    const context = { step: "기간 수집 목록 조회", request: { path, submissionId, timeoutMs },
      details: { "조회 일자": date, "시작 행": startIndex } };
    let retries = 0;
    let refreshed = false;
    const body = JSON.stringify({ dlBidPbancLstM: {
      ...searchConditions, fromBidDt: date, toBidDt: date, startIndex, endIndex: startIndex + pageSize - 1,
    } });
    for (;;) {
      let response: Response;
      let raw: string;
      try {
        request ??= await dependencies.createSession();
        response = await request(new URL(path, origin), {
          method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs),
        });
        raw = await readG2bResponse(response);
      } catch (error) {
        if (retries < retryDelays.length && (error instanceof TypeError ||
          (error instanceof Error && error.name === "TimeoutError"))) {
          await dependencies.wait(retryDelays[retries++]);
          continue;
        }
        throw collectionError(error, context);
      }
      if ((response.status === 429 || response.status >= 500) && retries < retryDelays.length) {
        const fallback = retryDelays[retries++];
        const delay = response.status === 429 ? retryAfterMs(response.headers.get("Retry-After")) : undefined;
        await waitForRetry(delay ?? fallback, dependencies.wait);
        continue;
      }

      const responseContext = { ...context, response: { status: response.status } };
      if (!response.ok && response.status !== 403) {
        throw collectionError(new Error(`입찰공고 목록 조회에 실패했습니다 (HTTP ${response.status}).`), responseContext);
      }
      let data: { ErrorCode?: string | number; result?: unknown };
      try {
        data = JSON.parse(raw);
      } catch (error) {
        throw collectionError(error, responseContext);
      }
      if (response.status === 403 && String(data?.ErrorCode) === "-801" && !refreshed) {
        // 쿠키 없는 호출에서 확인한 세션 오류에만 같은 페이지를 한 번 더 요청한다.
        refreshed = true;
        request = undefined;
        continue;
      }
      if (!response.ok || String(data?.ErrorCode) !== "0" || !Array.isArray(data.result)) {
        throw collectionError(new Error("입찰공고 목록의 정상 응답을 확인할 수 없습니다."), responseContext);
      }
      return data.result;
    }
  }

  // 모든 날짜의 페이지를 정상적으로 끝까지 읽은 후에만 목록을 반환한다.
  // 중간 실패 시 누적된 Map을 반환하지 않으므로 부분 대상이 큐로 넘어가지 않는다.
  for (let day = Math.floor(start / dayMs) * dayMs; day <= end; day += dayMs) {
    const date = new Date(day).toISOString().slice(0, 10).replaceAll("-", "");
    const seenPages = new Set<string>();
    let index = 1;
    for (;;) {
      const rows = (await readPage(date, index)).map((row, offset) => {
        try {
          return parseRow(row);
        } catch (error) {
          throw collectionError(error, {
            step: "기간 수집 목록 행 검증", details: { "조회 일자": date, "응답 행": index + offset },
          });
        }
      });
      if (!rows.length) break;
      // 행 번호나 순서가 바뀌어도 동일한 공고 집합을 다시 받으면 페이지 진행이 멈춘 것으로 본다.
      const signature = rows.map(({ key }) => key).sort().join(",");
      if (seenPages.has(signature)) {
        throw new Error(`입찰공고 목록에서 같은 페이지가 반복되었습니다 (${date}, ${index}행).`);
      }
      seenPages.add(signature);
      for (const { target, key, minute } of rows) {
        if (minute >= start && minute <= end && !targets.has(key)) targets.set(key, target);
      }
      // nextRowYn은 종료 판정에 사용하지 않는다. 실제 반환된 행 수만큼 이동한다.
      index += rows.length;
    }
  }
  return [...targets.values()];
}

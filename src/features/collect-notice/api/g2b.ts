import {
  contractRequestKeys,
  contractRequestRevision,
  type ContractRequestKey,
} from "@/entities/contract-request/model/contract-request";
import {
  contractKeys,
  contractSearchBody,
  parseContractResponse,
  type ContractKey,
} from "@/entities/contract/model/contract";
import type { Notice, NoticeKey } from "@/entities/notice";
import { getNoticeRepository } from "@/entities/notice/server";
import {
  groupOpeningResultQueries,
  openingResultQueries,
  type OpeningResultNotice,
  type OpeningResultKey,
  type OpeningResultQuery,
} from "@/entities/opening-result/model/opening-result";
import {
  openingResultDetail,
  openingResultRequest,
  openingResultNoticeRequests,
  openingResultNoticeFromResponse,
  openingResultPriceRequest,
  openingResultPriceFromResponse,
  selectOpeningResultNotice,
} from "../../../entities/opening-result/model/opening-result-api";
import {
  getNoticeOrderPlanNumber,
  orderPlanAttachmentGroup,
} from "@/entities/order-plan/model/order-plan";
import {
  getNoticePriorSpecNumber,
  type PriorSpec,
} from "@/entities/prior-spec/model/prior-spec";
import { createG2bSession } from "@/shared/api/g2b-session";
import {
  attachmentGroup,
  attachmentSources,
} from "@/shared/model/g2b-attachments";

// 메뉴별 Menu-Info와 submissionid는 나라장터 내부 API가 요청 화면을 구분하는 데 사용한다.
const origin = "https://www.g2b.go.kr";
const submissionPrefix = "FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_";
const detailMenu =
  '{"menuNo":"15620","menuCangVal":"FIUA027_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"08542"}';
const workProgressMenu =
  '{"menuNo":"13677","menuCangVal":"FIUA009_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"05665"}';
const openingResultMenu =
  '{"menuNo":"01523","menuCangVal":"PBOC007_01","bsneClsfCd":"%EC%97%85130028","scrnNo":"02128"}';
const openingResultPriceMenu =
  '{"menuNo":"01558","menuCangVal":"PBOC024_01","bsneClsfCd":"%EC%97%85130028","scrnNo":"04255"}';
const unifiedSearchPath = "/fi/fiu/fiua/UntySrch";

/** 제안요청 문서의 접근 거부를 일반 요청 실패와 구분하기 위한 오류 유형. */
class G2bAccessDenied extends Error {}

type G2bRequest = (url: URL, init: RequestInit) => Promise<Response>;

/**
 * 나라장터 내부 API에 JSON 요청을 보내고 HTTP 상태 및 업무 오류 코드를 검사한다.
 * 세션이 필요한 호출은 주입된 request를 사용하며, 메뉴 정보는 조회 화면에 맞게 지정한다.
 *
 * @param path API 경로.
 * @param submissionid 요청을 발생시킨 화면의 submission 식별자.
 * @param input 전송할 JSON 요청 데이터.
 * @param request 세션 요청 함수. 기본값은 fetch.
 * @param menuInfo 화면별 메뉴 식별 정보.
 * @returns 오류 코드 검증을 통과한 API 원본 응답.
 * @throws HTTP 접근 거부, 요청 실패 또는 API 업무 오류가 발생한 경우.
 */
async function postG2b(
  path: string,
  submissionid: string,
  input: object,
  request: G2bRequest = fetch,
  menuInfo = detailMenu,
) {
  const response = await request(new URL(path, origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json",
      Origin: origin,
      "Menu-Info": menuInfo,
      submissionid,
    },
    body: JSON.stringify(input),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 403)
    throw new G2bAccessDenied(`나라장터 API 접근이 거부됐습니다: ${path}`);
  if (!response.ok)
    throw new Error(`나라장터 API 요청에 실패했습니다: ${path}`);
  const result = await response.json();
  if (String(result?.ErrorCode) !== "0")
    throw new Error(`나라장터 API가 오류를 반환했습니다: ${path}`);
  return result;
}

/**
 * 문서 목록 응답의 필수 배열을 확인해 잘못된 응답을 저장 단계로 전달하지 않는다.
 *
 * @param path 문서 목록 조회 경로.
 * @param submission 요청 submission 식별자.
 * @param input 문서 조회 조건.
 * @param request 선택적 세션 요청 함수.
 * @returns 첨부 목록 배열이 확인된 API 원본 응답.
 * @throws 첨부 목록 형식이 올바르지 않거나 요청이 실패한 경우.
 */
async function collectDocumentList(
  path: string,
  submission: string,
  input: object,
  request?: G2bRequest,
) {
  const result = await postG2b(path, submission, input, request);
  if (!Array.isArray(result.dlUntyAtchFileL)) {
    throw new Error(
      `나라장터 문서 목록 응답 형식이 올바르지 않습니다: ${path}`,
    );
  }
  return result;
}

/**
 * 공고·발주계획·사전규격별 첨부 출처 설정을 적용해 공통 첨부 목록을 요청한다.
 *
 * @param untyAtchFileNo 첨부파일 그룹 번호.
 * @param scope 첨부 출처를 구분하는 업무 유형.
 * @param request 선택적 세션 요청 함수.
 * @returns 첨부 목록 조회 결과.
 */
function collectAttachments(
  untyAtchFileNo: string,
  scope: keyof typeof attachmentSources,
  request?: G2bRequest,
) {
  return collectDocumentList(
    "/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do",
    "sbmInsertAtflGrp",
    {
      dlUntyAtchFileM: {
        ...attachmentSources[scope],
        untyAtchFileNo,
        atchFileSqnos: "",
        bsneClsfCd: "업130020",
        webPathUse: "N",
        isScanEnabled: false,
        imgUrl: "",
        atchFileKndCds: "",
        ignoreAtchFileKndCds: "",
        kbrdrIds: "",
        kuploadId: "",
        viewMode: "view",
        ignoreScrnIndtYn: "",
      },
    },
    request,
  );
}

/**
 * 제안요청 상세의 첨부 목록을 세션이 포함된 요청으로 조회한다.
 *
 * @param rfpNo 제안요청 번호.
 * @param rfpOrd 제안요청 차수.
 * @param prcmBsneSeCd 조달 업무 구분 코드.
 * @returns 제안요청 문서 목록을 포함한 원본 응답.
 */
async function collectProposal(
  rfpNo: string,
  rfpOrd: string | number,
  prcmBsneSeCd: string,
) {
  const request = await createG2bSession();
  return collectDocumentList(
    "/pr/prp/prpc/Rfp/selectRfpDtl.do",
    submissionPrefix + "sbmRfp",
    {
      dlRfpM: { rfpNo, rfpOrd, prcmBsneSeCd, ctrtImplPicYn: "Y" },
    },
    request,
  );
}

// 동일 프로세스에서 같은 대상의 중복 수집을 공유한다. 영구적인 작업 큐나 DB 잠금은 아니다.
const pendingCollections = new Map<
  string,
  { force: boolean; promise: Promise<void> }
>();

/**
 * 동일 수집 대상의 진행 중 작업을 재사용하고 완료 후 공유 상태를 해제한다.
 * 강제 재수집은 진행 중인 일반 수집이 끝난 뒤 새로 실행해 요청이 생략되지 않게 한다.
 *
 * @param key 수집 대상 식별자.
 * @param force 기존 저장 여부와 무관한 강제 재수집 여부.
 * @param collect 실제 수집 작업.
 * @returns 실행 중이거나 새로 시작한 수집 작업의 Promise.
 */
async function collectOnce(
  key: string,
  force: boolean,
  collect: () => Promise<void>,
) {
  const pending = pendingCollections.get(key);
  if (pending) {
    if (!force || pending.force) return pending.promise;
    // 자동 수집은 저장 상태에 따라 일부 조회를 건너뛸 수 있으므로 수동 재수집은 별도로 실행한다.
    await pending.promise.catch(() => undefined);
    return collectOnce(key, force, collect);
  }
  const promise = collect().finally(() => pendingCollections.delete(key));
  pendingCollections.set(key, { force, promise });
  return promise;
}

/** 공고별 연기공고는 개찰차수에 관계없이 동일한 요청이므로 한 번만 조회한다. */
const pendingPostponement = new Map<
  string,
  Promise<OpeningResultNotice | null>
>();

/**
 * 연기공고와 분류별 개찰 공지사항을 조회해 화면에서 사용할 공지 하나를 선택한다.
 * 연기공고는 동일 공고의 동시 조회에서만 공유하고, 이후 요청에서는 다시 조회한다.
 *
 * @param key 공고 및 개찰차수 식별자.
 * @param queries 조회 대상 분류 목록.
 * @param request 세션 요청 함수.
 * @returns 선택된 공지사항 또는 공지가 없을 때 null.
 */
async function collectOpeningNotice(
  key: OpeningResultKey,
  queries: OpeningResultQuery[],
  request: G2bRequest,
): Promise<OpeningResultNotice | null> {
  const configs = openingResultNoticeRequests(
    key,
    queries.map((query) => query.classification),
  );
  const [postponementConfig, ...openingConfigs] = configs;
  const postponeKey = `${key.number}/${key.revision}`;
  let postponementPromise = pendingPostponement.get(postponeKey);
  if (!postponementPromise) {
    postponementPromise = postG2b(
      postponementConfig.path,
      postponementConfig.submission,
      postponementConfig.input,
      request,
      openingResultMenu,
    ).then(openingResultNoticeFromResponse);
    pendingPostponement.set(postponeKey, postponementPromise);
    // 동일 공고의 동시 수집만 공유하며, 이후 수집에서는 다시 조회한다.
    void postponementPromise
      .finally(() => {
        if (pendingPostponement.get(postponeKey) === postponementPromise)
          pendingPostponement.delete(postponeKey);
      })
      .catch(() => undefined);
  }
  const [postponement, ...openingNotices] = await Promise.all([
    postponementPromise,
    ...openingConfigs.map(async (config) =>
      openingResultNoticeFromResponse(
        await postG2b(
          config.path,
          config.submission,
          config.input,
          request,
          openingResultMenu,
        ),
      ),
    ),
  ]);
  return openingNotices.reduce<OpeningResultNotice | null>(
    (selected, opening) => selectOpeningResultNotice(selected, opening),
    postponement,
  );
}

/**
 * 개찰결과·공지사항·예정가격을 독립적으로 수집하며 성공한 데이터만 저장한다.
 * 저장된 분류는 일반 수집에서 건너뛰되, 강제 재수집 시 모두 다시 요청한다.
 * 일부 조회에 실패해도 성공 결과를 먼저 저장하고 실패 원인을 모아 호출자에게 전달한다.
 *
 * @param key 공고번호·공고차수·개찰차수.
 * @param queries 개찰차수에 속한 분류별 조회 조건.
 * @param force 저장 여부와 무관하게 다시 조회할지 여부.
 * @throws 하나 이상의 분류·공지사항·예정가격 조회가 실패한 경우 AggregateError.
 */
/** 개찰결과·공지사항·예정가격을 독립적으로 수집하며 성공한 데이터만 저장한다. */
export async function collectOpeningResult(
  key: OpeningResultKey,
  queries: OpeningResultQuery[],
  force = false,
) {
  const repository = getNoticeRepository();
  return collectOnce(
    `opening-result:${key.number}/${key.revision}/${key.openingRevision}`,
    force,
    async () => {
      const saved = repository.findOpeningResult(key);
      const previous = saved?.results ?? [];
      // 분류와 API 유형이 모두 같은 저장 결과만 수집 완료로 간주한다.
      const missing = queries.filter(
        (query) =>
          force ||
          !previous.some(
            (entry) =>
              entry.query.classification === query.classification &&
              (entry.query.endpoint ?? "selectOnbsRsltFbid") ===
                (query.endpoint ?? "selectOnbsRsltFbid"),
          ),
      );
      // null은 조회 완료 후 공지가 없다는 결과이므로 undefined인 경우에만 다시 조회한다.
      const needsNotice = force || saved?.notice === undefined;
      const priceQuery = queries[0];
      const needsPrice =
        Boolean(priceQuery) && (force || saved?.price === undefined);
      if (!missing.length && !needsNotice && !needsPrice) return;

      const request = await createG2bSession();
      const [resultOutcome, noticeOutcome, priceOutcome] = await Promise.all([
        Promise.allSettled(
          missing.map(async (query) => {
            const config = openingResultRequest(key, query);
            const payload = await postG2b(
              config.path,
              config.submission,
              config.input,
              request,
              openingResultMenu,
            );
            return {
              query,
              detail: openingResultDetail(config.endpoint, payload, key, query),
            };
          }),
        ),
        needsNotice
          ? collectOpeningNotice(key, queries, request).then(
              (value) => ({ status: "fulfilled" as const, value }),
              (reason: unknown) => ({ status: "rejected" as const, reason }),
            )
          : Promise.resolve({ status: "skipped" as const }),
        needsPrice && priceQuery
          ? (async () => {
              const config = openingResultPriceRequest(key, priceQuery);
              const payload = await postG2b(
                config.path,
                config.submission,
                config.input,
                request,
                openingResultPriceMenu,
              );
              return openingResultPriceFromResponse(payload, key, priceQuery);
            })().then(
              (value) => ({ status: "fulfilled" as const, value }),
              (reason: unknown) => ({ status: "rejected" as const, reason }),
            )
          : Promise.resolve({ status: "skipped" as const }),
      ]);
      const successes = resultOutcome.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      // 성공한 분류만 새 결과로 교체하고 실패하거나 요청하지 않은 기존 분류는 유지한다.
      const updated = [
        ...previous.filter(
          (entry) =>
            !successes.some(
              ({ query }) =>
                query.classification === entry.query.classification,
            ),
        ),
        ...successes,
      ];
      // 세 종류 중 하나라도 성공했을 때만 저장하며 실패한 부가 자료는 기존 값을 유지한다.
      if (
        successes.length ||
        noticeOutcome.status === "fulfilled" ||
        priceOutcome.status === "fulfilled"
      ) {
        repository.saveOpeningResult({
          ...key,
          collectedAt: new Date().toISOString(),
          results: updated,
          ...(noticeOutcome.status === "fulfilled"
            ? { notice: noticeOutcome.value }
            : saved?.notice !== undefined
              ? { notice: saved.notice }
              : {}),
          ...(priceOutcome.status === "fulfilled"
            ? { price: priceOutcome.value }
            : saved?.price !== undefined
              ? { price: saved.price }
              : {}),
        });
      }
      // 저장 후 오류를 반환해 호출자가 부분 실패를 인지하도록 한다.
      const failures = resultOutcome.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      const reasons = failures.map(({ reason }) => reason);
      if (noticeOutcome.status === "rejected")
        reasons.push(noticeOutcome.reason);
      if (priceOutcome.status === "rejected") reasons.push(priceOutcome.reason);
      if (reasons.length) {
        throw new AggregateError(
          reasons,
          `개찰결과 ${failures.length}/${missing.length}개 분류, 공지사항 또는 예정가격 수집 실패 (성공 결과는 저장됨)`,
        );
      }
    },
  );
}

/**
 * 공고 응답에서 개찰차수별 조회 조건을 구성하고 차수별 수집을 실행한다.
 * 모든 차수의 결과를 확인한 뒤 실패한 차수의 오류를 묶어 전달한다.
 *
 * @param payload 공고 상세 API 원본 응답.
 * @throws 개찰차수 중 하나 이상 수집에 실패한 경우 AggregateError.
 */
async function collectNoticeOpeningResults(payload: Record<string, unknown>) {
  const groups = groupOpeningResultQueries(openingResultQueries(payload));
  const settled = await Promise.allSettled(
    [...groups.values()].map(([first, ...rest]) => {
      const { number, revision, openingRevision } = first;
      return collectOpeningResult({ number, revision, openingRevision }, [
        first,
        ...rest,
      ]);
    }),
  );
  const failures = settled.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length) {
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      `개찰결과 ${failures.length}/${groups.size}개 개찰차수 수집 실패`,
    );
  }
}

/**
 * 공고번호와 차수로 업무 진행 내역을 조회해 계약·계약요청 연결 후보를 얻는다.
 *
 * @param key 공고번호와 공고차수.
 * @returns 업무 진행 내역 목록.
 * @throws 응답의 업무 진행 목록이 배열이 아닌 경우.
 */
async function fetchWorkProgress({
  number,
  revision,
}: NoticeKey): Promise<Record<string, unknown>[]> {
  const result = await postG2b(
    `${unifiedSearchPath}/srchWorkPrgs.do`,
    "sbmWorkPrgs",
    {
      dlWorkParamM: {
        workSrchSeCd: "BK",
        workBizNo: number,
        workBizOrd: revision,
      },
    },
    fetch,
    workProgressMenu,
  );
  if (!Array.isArray(result.dlWorkPrgsL))
    throw new Error("나라장터 업무 진행 응답 형식이 올바르지 않습니다.");
  return result.dlWorkPrgsL;
}

/**
 * 계약현황 상세와 세 목록을 조회하고 유효한 응답만 저장한다.
 * @param key 계약번호와 정규화된 변경차수.
 * @param force 기본값은 false. true이면 기존 상세도 다시 조회한다.
 * @throws 조회 실패 또는 요청과 다른 응답을 받았을 때. 저장 자료는 유지된다.
 */
export async function collectContract(key: ContractKey, force = false) {
  const repository = getNoticeRepository();
  return collectOnce(
    `contract:${key.number}/${key.revision}`,
    force,
    async () => {
      if (!force && repository.findContract(key)) return;
      const collectedAt = new Date().toISOString();
      const result = await postG2b(
        `${unifiedSearchPath}/srchCtrtDtl.do`,
        "FIUA027_01_wframe_popupCnts_ctrtWfrm_srchDtl",
        contractSearchBody(key),
      );
      const contract = parseContractResponse(key, result);
      if (!contract)
        throw new Error("요청한 계약현황의 상세 응답을 받지 못했습니다.");
      repository.saveContract({ ...key, collectedAt, ...contract });
    },
  );
}

const contractItemPageSize = 10;

/**
 * 계약요청 상세 또는 품목 조회에 공통으로 사용하는 검색 조건을 구성한다.
 *
 * @param endpoint 상세·품목 조회 API 이름.
 * @param key 계약요청 식별자.
 * @param page 품목 조회 페이지.
 * @returns API 조회 Promise.
 */
function fetchContractRequestData(
  endpoint: string,
  { number, revision }: ContractRequestKey,
  page = 1,
) {
  return postG2b(
    `${unifiedSearchPath}/${endpoint}.do`,
    "FIUA027_01_wframe_popupCnts_dmndWfrm_srchDtl",
    {
      dlSrchParamM: {
        untyInspIgiNo: "",
        untyPyprNo: "",
        ctrtDmndRcptNo: "",
        ctrtDmndRcptOrd: "",
        page: String(page),
        pageSize: String(contractItemPageSize),
        ctrtNo: "",
        ctrtChgOrd: "",
        bizNo: number,
        bizOrd: revision,
        prcmBsneSeCd: "",
      },
    },
  );
}

/**
 * 계약요청 품목을 페이지 단위로 모두 조회하고 식별자 및 반복 페이지를 검사한다.
 * 같은 페이지가 반복되면 종료 조건에 도달하지 못할 수 있어 오류로 처리한다.
 *
 * @param key 계약요청 식별자.
 * @returns 검증을 통과한 전체 품목 목록.
 * @throws 식별자가 다른 품목이나 반복 페이지가 반환된 경우.
 */
async function collectContractRequestItems(key: ContractRequestKey) {
  const items: Record<string, unknown>[] = [];
  const seenPages = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await fetchContractRequestData(
      "srchDmndSttusItemSql",
      key,
      page,
    );
    const rows = result.dlTotalSrchItemL;
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          row?.ctrtDmndRcptNo !== key.number ||
          contractRequestRevision(row.ctrtDmndRcptOrd) !== key.revision,
      )
    ) {
      throw new Error("요청한 계약요청의 품목 응답을 받지 못했습니다.");
    }
    // API가 다음 페이지에도 같은 품목을 반환하면 중복 저장과 무한 조회를 막는다.
    const signature = JSON.stringify(rows.map(({ rowNum, ...item }) => item));
    if (seenPages.has(signature))
      throw new Error(
        "나라장터가 같은 계약요청 품목 페이지를 반복 반환했습니다.",
      );
    seenPages.add(signature);
    items.push(...rows);
    if (rows.length < contractItemPageSize) return items;
  }
}

/**
 * 계약요청의 상세와 품목을 수집해 함께 저장한다.
 * @param key 계약요청접수번호와 차수.
 * @param force 기본값은 false. true이면 기존 자료도 다시 조회한다.
 * @throws 상세 또는 품목 조회에 실패했을 때. 기존 저장 자료는 유지된다.
 */
export async function collectContractRequest(
  key: ContractRequestKey,
  force = false,
) {
  const repository = getNoticeRepository();
  return collectOnce(
    `contract-request:${key.number}/${key.revision}`,
    force,
    async () => {
      if (!force && repository.findContractRequest(key)) return;
      const collectedAt = new Date().toISOString();
      const [summary, items] = await Promise.allSettled([
        fetchContractRequestData("srchDmndSttusSql", key),
        collectContractRequestItems(key),
      ]);
      if (summary.status === "rejected") throw summary.reason;
      if (items.status === "rejected") throw items.reason;
      const result = summary.value;
      const detail =
        Array.isArray(result.dlTotalSrchL) &&
        result.dlTotalSrchL.find(
          (row: Record<string, unknown>) =>
            row?.bizNo === key.number &&
            contractRequestRevision(row.bizOrd) === key.revision,
        );
      if (!detail)
        throw new Error("요청한 계약요청의 상세 응답을 받지 못했습니다.");
      repository.saveContractRequest({
        ...key,
        collectedAt,
        detail,
        items: items.value,
      });
    },
  );
}

/**
 * 공고 업무 진행 내역에서 계약요청·계약 연결을 추출한다.
 * 계약요청 상세 조회 실패와 관계없이 확인된 연결 관계는 반환한다.
 *
 * @param key 공고번호와 공고차수.
 * @returns 계약요청 및 계약 식별자 목록.
 */
async function collectNoticeContractLinks(key: NoticeKey) {
  const rows = await fetchWorkProgress(key);
  const requests = contractRequestKeys(rows, key);
  // 상세 조회가 실패해도 공고에는 확인된 연결을 남겨 해당 페이지에서 다시 수집할 수 있게 한다.
  await Promise.allSettled(
    requests.map((request) => collectContractRequest(request)),
  );
  return { contractRequests: requests, contracts: contractKeys(rows, key) };
}

/**
 * 발주계획 상세와 첨부 목록을 수집해 저장한다.
 * @param number 발주계획번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 모두 다시 조회하고 성공 시 교체한다.
 * @throws 나라장터 상세 또는 첨부 목록 조회가 실패했을 때.
 */
export async function collectOrderPlan(number: string, force = false) {
  const repository = getNoticeRepository();

  return collectOnce(`order-plan:${number}`, force, async () => {
    let plan = force ? null : repository.findOrderPlan(number);
    // 저장된 본문이 있고 첨부 수집이 끝났거나 첨부 그룹이 없으면 중복 요청을 피한다.
    if (plan && (plan.attachments || !orderPlanAttachmentGroup(plan))) return;
    const request = await createG2bSession();
    if (!plan) {
      const collectedAt = new Date().toISOString();
      const payload = await postG2b(
        "/pr/prp/prpa/OderPlan/selectOderPlan.do",
        "FIUA027_01_wframe_popupCnts_orderPlanWfrm_sbmSrch",
        { dlParamM: { oderPlanNo: number, resultCnt: "" } },
        request,
      );
      if (payload?.dlOderPlanM?.oderPlanNo !== number) {
        throw new Error("요청한 발주계획의 상세 응답을 받지 못했습니다.");
      }
      plan = { number, collectedAt, payload };
      // 첨부 목록 요청에 실패해도 본문을 보존하고 다음 수집에서 첨부만 재시도한다.
      if (!force) repository.saveOrderPlan(plan);
    }
    const group = orderPlanAttachmentGroup(plan);
    const attachments = group
      ? await collectAttachments(group, "order-plan", request)
      : undefined;
    if (force) repository.replaceOrderPlan({ ...plan, attachments });
    else if (attachments)
      repository.saveOrderPlanAttachments(
        number,
        plan.collectedAt,
        attachments,
      );
  });
}

/**
 * 사전규격 상세와 공개 첨부 목록을 번호별로 수집한다.
 * @param number 사전규격등록번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 다시 조회하고 성공 시 교체한다.
 * @throws 나라장터 상세 또는 첨부 목록 조회가 실패했을 때.
 */
export async function collectPriorSpec(number: string, force = false) {
  const repository = getNoticeRepository();
  return collectOnce(`prior-spec:${number}`, force, async () => {
    let spec: PriorSpec | null = force
      ? null
      : repository.findPriorSpec(number);
    // 첨부 그룹이 없는 사전규격은 첨부 조회 없이 수집 완료로 취급한다.
    if (
      spec &&
      (spec.attachments ||
        !attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo))
    )
      return;
    const request = await createG2bSession();
    if (!spec) {
      const collectedAt = new Date().toISOString();
      const payload = await postG2b(
        "/pn/pnz/pnza/BfSpec/selectBfSpec.do",
        "FIUA027_01_wframe_popupCnts_bfSpecWfrm_sbmSrch",
        {
          dlParamM: {
            bfSpecRegNo: number,
            prcmBsneSeCd: "",
            opnnSqno: "",
            jobType: "",
          },
        },
        request,
      );
      if (payload?.dlBfSpecM?.bfSpecRegNo !== number) {
        throw new Error("요청한 사전규격의 상세 응답을 받지 못했습니다.");
      }
      spec = { number, collectedAt, payload };
      if (!force) repository.savePriorSpec(spec);
    }
    const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
    const attachments = group
      ? await collectAttachments(group, "prior-spec", request)
      : undefined;
    if (force || attachments)
      repository.savePriorSpec({ ...spec, attachments });
  });
}

/**
 * 공고 상세와 문서 목록을 수집하고, 연결된 미수집 발주계획, 사전규격, 계약요청과 개찰결과를 저장한다.
 * 관련 자료 조회가 실패하면 다음 공고 수집 시 재시도한다.
 * @param key 공고번호와 차수.
 * @param methodCode 상세 조회에 전달하는 낙찰방법 코드.
 * @returns 공고 상세 및 해당하는 문서 목록의 원본 응답.
 * @throws 공고 상세 요청이 실패하거나 해당 공고의 응답을 받지 못했을 때.
 */
export async function collectNotice(
  key: NoticeKey,
  methodCode: string,
): Promise<Notice> {
  const collectedAt = new Date().toISOString();
  const payload = await postG2b(
    "/pn/pnp/pnpe/ItemBidPbac/selectItemAnncMngV.do",
    submissionPrefix + "selectItemAnncMngV",
    {
      dmItemMap: {
        bidPbancNo: key.number,
        bidPbancOrd: key.revision,
        scsbdMthdCd: methodCode,
        currentPage: 1,
      },
    },
  );
  const detail = payload?.dmItemMap;
  if (
    detail?.bidPbancNo !== key.number ||
    String(detail.bidPbancOrd).padStart(3, "0") !== key.revision ||
    typeof detail.bidPbancNm !== "string" ||
    !detail.bidPbancNm.trim()
  ) {
    throw new Error("요청한 공고의 상세 응답을 받지 못했습니다.");
  }
  // 첨부 목록은 공고의 첨부 그룹만 조회하고, 제안요청은 상세 JS와 같이 협상계약에만 적용한다.
  const orderPlanNumber = getNoticeOrderPlanNumber(payload);
  const priorSpecNumber = getNoticePriorSpecNumber(payload);
  // 부가 조회의 실패가 공고 본문 수집을 막지 않도록 각각의 결과를 따로 수신한다.
  const [attachments, proposal, contractLinks, openingResults] =
    await Promise.allSettled([
      detail.itemPbancUntyAtchFileNo?.trim()
        ? collectAttachments(detail.itemPbancUntyAtchFileNo, "notice")
        : undefined,
      detail.scsbdMthdCd === "낙030005" &&
      detail.rfpNo?.trim() &&
      /^\d{1,3}$/.test(String(detail.rfpOrd))
        ? collectProposal(detail.rfpNo, detail.rfpOrd, detail.prcmBsneSeCd)
        : undefined,
      collectNoticeContractLinks(key),
      collectNoticeOpeningResults(payload),
      orderPlanNumber ? collectOrderPlan(orderPlanNumber) : undefined,
      priorSpecNumber ? collectPriorSpec(priorSpecNumber) : undefined,
    ]);
  if (openingResults.status === "rejected") {
    console.error("개찰결과 수집 실패:", openingResults.reason);
  }
  // 문서 조회 오류가 공고 상세와 다른 문서의 저장을 막지 않도록 실패 종류를 따로 기록한다.
  const documents: NonNullable<Notice["documents"]> = {
    attachments:
      attachments.status === "fulfilled" ? attachments.value : undefined,
    proposal: proposal.status === "fulfilled" ? proposal.value : undefined,
    unavailable: [],
  };
  if (attachments.status === "rejected")
    documents.unavailable?.push("attachments");
  if (proposal.status === "rejected") {
    documents.unavailable?.push("proposal");
    if (proposal.reason instanceof G2bAccessDenied)
      documents.proposalAccessDenied = true;
  }

  return {
    ...key,
    title: detail.bidPbancNm,
    collectedAt,
    payload,
    documents,
    ...(contractLinks.status === "fulfilled" ? contractLinks.value : {}),
  };
}

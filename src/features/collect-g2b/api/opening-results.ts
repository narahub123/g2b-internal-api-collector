import { getG2bRepository } from "@/server/g2b/repository";
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
} from "@/entities/opening-result/model/opening-result-api";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { throwIfMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { postG2b, type G2bRequest } from "./request";
import { collectOnce } from "./collect-once";

const openingResultMenu =
  '{"menuNo":"01523","menuCangVal":"PBOC007_01","bsneClsfCd":"%EC%97%85130028","scrnNo":"02128"}';

const openingResultPriceMenu =
  '{"menuNo":"01558","menuCangVal":"PBOC024_01","bsneClsfCd":"%EC%97%85130028","scrnNo":"04255"}';

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
 * @throws 조회가 실패한 경우. 동시에 점검과 일반 오류가 확인되면 점검 오류를 우선 전달한다.
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
  const outcomes = await Promise.allSettled([
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
  throwIfMaintenance(...outcomes);
  const [postponement, ...openingNotices] = outcomes.map((outcome) => {
    if (outcome.status === "rejected") throw outcome.reason;
    return outcome.value;
  });
  return openingNotices.reduce<OpeningResultNotice | null>(
    (selected, opening) => selectOpeningResultNotice(selected, opening),
    postponement,
  );
}

/**
 * 개찰결과·공지사항·예정가격을 독립적으로 조회하고 개찰차수별로 저장한다.
 * 일반 수집은 이미 확인한 자료를 건너뛰며, 일반 오류가 섞이면 성공 결과를 먼저 저장한다.
 * 점검을 확인하면 성공 결과가 있어도 해당 차수를 갱신하지 않는다.
 *
 * @param key 공고번호·공고차수·개찰차수.
 * @param queries 개찰차수에 속한 분류별 조회 조건.
 * @param force 저장 여부와 무관하게 다시 조회할지 여부.
 * @throws 점검 확인 시 G2bMaintenanceError, 일반 부가 조회 실패 시 AggregateError.
 * 세션 발급이나 저장소 접근이 실패하면 해당 오류를 전달한다.
 */
export async function collectOpeningResult(
  key: OpeningResultKey,
  queries: OpeningResultQuery[],
  force = false,
) {
  const repository = getG2bRepository();
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
      // 점검 중 일부 조회가 성공해도 해당 개찰차수의 기존 자료를 유지한다.
      throwIfMaintenance(...resultOutcome, noticeOutcome, priceOutcome);
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
      // 일반 조회 오류는 성공 자료를 저장한 뒤 모아서 전달해 부분 실패를 알린다.
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
export async function collectNoticeOpeningResults(payload: Record<string, unknown>) {
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

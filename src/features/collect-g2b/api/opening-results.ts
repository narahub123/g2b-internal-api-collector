import { collectionStep, collectionError } from "@/shared/api/g2b/collection-diagnostic";
import { getG2bRepository } from "@/server/g2b/repository";
import {
  groupOpeningResultQueries,
  openingResultQueries,
  resolveOpeningResultEndpoint,
  type OpeningResultEntry,
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
import { findMaintenance, throwIfMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { postG2b, type G2bRequest } from "./request";
import { collectOnce } from "./collect-once";
import { trackCollectionAttempt, trackCollectionLookup } from "./collection-attempt";
import { qualificationReviewVisible } from "@/entities/opening-result/model/opening-result-display";
import { fetchQualificationReview } from "./qualification-review";

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
    if (outcome.status === "rejected") throw new AggregateError(
      outcomes.flatMap((entry) => entry.status === "rejected" ? [entry.reason] : []),
      "개찰결과 공지사항 조회가 실패했습니다.",
    );
    return outcome.value;
  });
  return openingNotices.reduce<OpeningResultNotice | null>(
    (selected, opening) => selectOpeningResultNotice(selected, opening),
    postponement,
  );
}

/**
 * 개찰결과·공지사항과 대상 분류의 적격심사결과를 저장한다.
 * 예정가격은 개찰완료 분류가 있을 때 첫 번째 해당 분류로 차수당 한 번 조회한다.
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
      const saved = await trackCollectionLookup({ section: "opening-results", ...key, queries }, "개찰결과", () => repository.findOpeningResult(key));
      const previous = saved?.results ?? [];
      const previousByClassification = new Map(previous.map((entry) => [entry.query.classification, entry]));
      const matchingPrevious = (query: OpeningResultQuery) => {
        const entry = previousByClassification.get(query.classification);
        return entry && resolveOpeningResultEndpoint(entry.query) ===
          resolveOpeningResultEndpoint(query) ? entry : undefined;
      };
      const needsReview = ({ query, detail, qualificationReview }: OpeningResultEntry) =>
        (force || qualificationReview === undefined) &&
        qualificationReviewVisible(resolveOpeningResultEndpoint(query), detail);
      // 분류와 API 유형이 모두 같은 저장 결과만 수집 완료로 간주한다.
      const missing = queries.filter((query) => force || !matchingPrevious(query));
      const savedReviewTargets = force ? [] : queries.flatMap((query) => {
        const entry = matchingPrevious(query);
        return entry && needsReview(entry) ? [entry] : [];
      });
      // null은 조회 완료 후 공지가 없다는 결과이므로 undefined인 경우에만 다시 조회한다.
      const needsNotice = force || saved?.notice === undefined;
      // 유찰·입찰취소·재입찰과 상태 없는 구형 유찰은 예정가격 조회 대상에서 제외한다.
      const priceQuery = queries.find(({ status }) => status === "개찰완료");
      const needsPrice =
        Boolean(priceQuery) && (force || saved?.price === undefined);
      if (!missing.length && !savedReviewTargets.length && !needsNotice && !needsPrice) return;
      return trackCollectionAttempt({ section: "opening-results", ...key, queries }, async (recordFailure) => {
        const request = await createG2bSession();
        const resultPromise = Promise.allSettled(
          missing.map(async (query) => {
            const config = openingResultRequest(key, query);
            const payload = await postG2b(
              config.path,
              config.submission,
              config.input,
              request,
              openingResultMenu,
            );
            const entry: OpeningResultEntry = {
              query,
              detail: collectionStep("개찰결과 응답 검증", () =>
                openingResultDetail(config.endpoint, payload, key, query)),
            };
            const previousReview = matchingPrevious(query)?.qualificationReview;
            if (previousReview !== undefined) entry.qualificationReview = previousReview;
            return entry;
          }),
        );
        const reviewPromise = resultPromise.then(async (outcomes) => {
          // 개찰 조회에서 점검을 확인한 뒤에는 후속 심사 요청을 새로 보내지 않는다.
          if (outcomes.some((outcome) => outcome.status === "rejected" && findMaintenance(outcome.reason))) {
            return { targets: [], settled: [] };
          }
          // 새 개찰 상세의 판정 조건을 우선하며 실패한 새 개찰 조회에는 기존 자료를 유지한다.
          const targets = [
            ...savedReviewTargets,
            ...outcomes.flatMap((outcome) => outcome.status === "fulfilled" && needsReview(outcome.value)
              ? [outcome.value] : []),
          ];
          const settled = await Promise.allSettled(targets.map(({ query }) => fetchQualificationReview(query, request)));
          return { targets, settled };
        });
        const [resultOutcome, noticeOutcome, priceOutcome, reviewOutcome] = await Promise.all([
          resultPromise,
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
                return collectionStep("예정가격 응답 검증", () =>
                  openingResultPriceFromResponse(payload, key, priceQuery));
              })().then(
                (value) => ({ status: "fulfilled" as const, value }),
                (reason: unknown) => ({ status: "rejected" as const, reason }),
              )
            : Promise.resolve({ status: "skipped" as const }),
          reviewPromise,
        ]);
        const failures = resultOutcome.flatMap((outcome, index) => outcome.status === "rejected"
          ? [collectionError(new Error("개찰결과 분류 조회 실패", { cause: outcome.reason }), {
              step: "개찰결과 조회", details: { "개찰 분류": missing[index].classification },
            })]
          : []);
        const reasons = [...failures];
        if (noticeOutcome.status === "rejected")
          reasons.push(new Error("개찰결과 공지사항 조회 실패", { cause: noticeOutcome.reason }));
        if (priceOutcome.status === "rejected")
          reasons.push(new Error("개찰결과 예정가격 조회 실패", { cause: priceOutcome.reason }));
        const reviewUpdates = new Map<string, OpeningResultEntry["qualificationReview"]>();
        reviewOutcome.settled.forEach((outcome, index) => {
          const { query } = reviewOutcome.targets[index];
          if (outcome.status === "fulfilled") {
            reviewUpdates.set(query.classification, outcome.value);
          } else {
            reasons.push(collectionError(new Error("적격심사결과 조회 실패", { cause: outcome.reason }), {
              step: "적격심사결과 조회", details: { "개찰 분류": query.classification },
            }));
          }
        });
        // 점검 중에는 저장을 보류하되 함께 실패한 조회도 보존한다.
        try {
          throwIfMaintenance(...resultOutcome, noticeOutcome, priceOutcome, ...reviewOutcome.settled);
        } catch {
          throw new AggregateError(reasons, "나라장터 점검으로 개찰결과 저장을 보류했습니다.");
        }
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
        ].map((entry) => reviewUpdates.has(entry.query.classification)
          ? { ...entry, qualificationReview: reviewUpdates.get(entry.query.classification) }
          : entry);
        // 성공한 자료만 반영하며 실패한 부가 자료는 기존 값을 유지한다.
        if (
          successes.length || reviewUpdates.size ||
          noticeOutcome.status === "fulfilled" ||
          priceOutcome.status === "fulfilled"
        ) {
          try {
            collectionStep("SQLite 개찰결과 저장", () => repository.saveOpeningResult({
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
            }));
          } catch (error) {
            reasons.forEach(recordFailure);
            throw error;
          }
        }
        // 일반 조회 오류는 성공 자료를 저장한 뒤 모아서 전달해 부분 실패를 알린다.
        if (reasons.length) {
          throw new AggregateError(
            reasons,
            `개찰결과 ${failures.length}/${missing.length}개 분류 또는 부가 자료 수집 실패 (성공 결과는 저장됨)`,
          );
        }
      });
    },
  );
}

// 성공과 실패를 보존해 입찰공고와 개찰결과 API가 같은 조회 결과를 사용할 수 있게 한다.
export type OpeningCollectionReport = {
  targetRevisions: string[];
  succeededRevisions: string[];
  failures: { revision: string; error: unknown }[];
};

/**
 * 개찰차수별 작업을 병렬 실행하고 성공과 실패를 차수 단위로 반환한다.
 * @param force true이면 저장된 결과도 다시 조회한다.
 */
export async function collectOpeningGroups(
  groups: Map<string, OpeningResultQuery[]>,
  force = false,
): Promise<OpeningCollectionReport> {
  const entries = [...groups];
  const settled = await Promise.allSettled(
    entries.map(([openingRevision, queries]) => {
      const { number, revision } = queries[0];
      return collectOpeningResult({ number, revision, openingRevision }, queries, force);
    }),
  );
  const targetRevisions = entries.map(([revision]) => revision);
  const succeededRevisions: string[] = [];
  const failures: OpeningCollectionReport["failures"] = [];
  settled.forEach((result, index) => {
    const revision = targetRevisions[index];
    if (result.status === "fulfilled") succeededRevisions.push(revision);
    else failures.push({ revision, error: result.reason });
  });
  return { targetRevisions, succeededRevisions, failures };
}

/**
 * 공고 원본에서 개찰 조회 조건을 생성하고 아직 필요한 결과를 수집한다.
 * @returns 개찰차수별 결과. 공고 저장 여부는 호출자가 결정한다.
 */
export function collectNoticeOpeningResults(payload: Record<string, unknown>) {
  return collectOpeningGroups(groupOpeningResultQueries(openingResultQueries(payload)));
}

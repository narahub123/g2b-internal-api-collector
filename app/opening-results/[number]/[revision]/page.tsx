import Link from "next/link";
import { notFound } from "next/navigation";
import { noticePath } from "@/entities/notice/lib/notice-path";
import type { NoticeKey } from "@/entities/notice/model/types";
import { getNoticeRepository } from "@/entities/notice/server";
import {
  openingResultPath,
  openingResultQueries,
  type OpeningResult,
} from "@/entities/opening-result/model/opening-result";
import { OpeningResultDetail } from "@/entities/opening-result/ui/OpeningResultDetail";
import { g2bNumber } from "@/shared/model/g2b-number";
import { resolveG2bBusiness } from "@/shared/lib/g2b-business";
import { Button } from "@/shared/ui/button";
import { RecollectButton } from "@/shared/ui/recollect-button";

/**
 * 저장된 공고 원본 진행현황과 개찰결과의 식별자를 대조해 원본 페이지 링크를 생성한다.
 * 개찰차수·분류가 여러 개이면 화면의 첫 번째 저장 결과를 기준으로 하며,
 * 원본 상태 코드를 확인할 수 없으면 잘못된 링크를 만들지 않는다.
 * 저장 자료를 수정하거나 외부 요청을 수행하지 않는다.
 */
function openingResultOriginalHref(
  payload: Record<string, unknown> | undefined,
  results: OpeningResult[],
): string | undefined {
  if (!payload) return undefined;
  const first = results.flatMap((result) =>
    result.results.map(({ query }) => query),
  )[0];
  if (!first) return undefined;
  const rows = payload.dlBidBasePgstL;
  if (!Array.isArray(rows)) return undefined;
  const row = rows.find((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const item = value as Record<string, unknown>;
    const sameRevision = (value: unknown, expected: string) =>
      /^\d{1,3}$/.test(String(value ?? "")) &&
      String(value).padStart(3, "0") === expected;
    return (
      item.bidPbancNo === first.number &&
      sameRevision(item.bidPbancOrd, first.revision) &&
      sameRevision(item.bidPrgrsOrd, first.openingRevision) &&
      String(item.bidClsfNo ?? "") === first.classification &&
      typeof item.bidPgstCd === "string" &&
      /^입160\d{3}$/.test(item.bidPgstCd)
    );
  }) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const params = new URLSearchParams({
    bidPbancNo: first.number,
    bidPbancOrd: first.revision,
    reBidNo: first.openingRevision,
    bidClsfNo: first.classification,
    bidPgstCd: String(row.bidPgstCd),
    prcmBsneSeCd: first.businessCode,
    pbancType: "pbanc",
  });
  return `https://www.g2b.go.kr/link/PBOC007_01/single/?${params}`;
}

export default async function Page({ params }: { params: Promise<NoticeKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || !/^\d{3}$/.test(key.revision))
    notFound();
  const repository = getNoticeRepository();
  const notice = await repository.find(key);
  const results = repository.listOpeningResults(key);
  if (
    !results.length &&
    (!notice || !openingResultQueries(notice.payload).length)
  )
    notFound();

  const noticeDetail = notice?.payload.dmItemMap as Record<string, unknown> | undefined;
  // 여러 차수·분류가 같은 업무일 때만 저장된 조회 조건으로 공통 제목을 보완한다.
  const businessCodes = new Set(
    results.flatMap(({ results }) =>
      results.map(({ query }) => resolveG2bBusiness(query.businessCode, undefined)?.code),
    ),
  );
  const business = resolveG2bBusiness(noticeDetail?.prcmBsneSeCd, noticeDetail?.prcmBsneSeNm)
    ?? (businessCodes.size === 1
      ? resolveG2bBusiness(businessCodes.values().next().value, undefined)
      : undefined);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href={notice ? noticePath(key) : "/"}>
          {notice ? "입찰공고로 돌아가기" : "목록으로 돌아가기"}
        </Link>
      </Button>
      <h1 className="sr-only">개찰결과</h1>
      {results.length ? (
        <OpeningResultDetail
          noticeKey={key}
          results={results}
          title={notice?.title}
          business={business}
          originalHref={openingResultOriginalHref(notice?.payload, results)}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            이 공고의 유찰 상세를 아직 수집하지 않았습니다.
          </p>
          <RecollectButton endpoint={`/api${openingResultPath(key)}`} initial />
        </div>
      )}
    </main>
  );
}

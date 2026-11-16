import { DetailNavigation } from "@/_pages/admin/g2b/ui/DetailNavigation";
import { CollectionDetailActions } from "@/_pages/admin/g2b/ui/CollectionDetailActions";
import { noticePath } from "@/_pages/admin/config/routes";
import { openingResultApiPath } from "@/features/collect-g2b/api/routes";
import { notFound } from "next/navigation";
import type { NoticeKey } from "@/entities/notice/model/types";
import { getG2bRepository } from "@/server/g2b/repository";
import { openingResultQueries } from "@/entities/opening-result/model/opening-result";
import { OpeningResultDetail } from "@/entities/opening-result/ui/OpeningResultDetail";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { openingResultHeader } from "@/entities/opening-result/model/opening-result-header";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { BusinessBadge } from "@/shared/ui/g2b/BusinessBadge";
import { UncollectedBadge } from "@/shared/ui/g2b/UncollectedBadge";

/**
 * 공고와 차수별 개찰결과를 조회해 상세 및 연결된 공고로 돌아가는 링크를 구성한다.
 * @throws 공고번호나 차수가 유효하지 않거나, 저장 결과와 조회 가능한 공고가 모두 없으면 404 처리한다. 저장소 조회 오류는 호출자에 전달한다.
 */
export async function OpeningResultDetailPage({ params }: { params: Promise<NoticeKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || !/^\d{3}$/.test(key.revision))
    notFound();
  const repository = getG2bRepository();
  const notice = await repository.find(key);
  const results = await repository.listOpeningResults(key);
  if (
    !results.length &&
    (!notice || !openingResultQueries(notice.payload).length)
  )
    notFound();

  const header = openingResultHeader(notice, results);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <DetailNavigation section="opening-results" />
      <h1 className="sr-only">개찰결과</h1>
      {results.length ? (
        <OpeningResultDetail
          noticeKey={key}
          noticePath={noticePath}
          actions={
            <CollectionDetailActions section="opening-results" records={results}>
              <RecollectButton endpoint={openingResultApiPath(key)} compact />
            </CollectionDetailActions>
          }
          results={results}
          {...header}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            개찰결과 <BusinessBadge business={header.business} />{" "}
            <UncollectedBadge /> 이 공고의 유찰 상세를 아직 수집하지 않았습니다.
          </p>
          <RecollectButton endpoint={openingResultApiPath(key)} initial />
        </div>
      )}
    </div>
  );
}

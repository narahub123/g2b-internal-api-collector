import Link from "next/link";
import { notFound } from "next/navigation";
import { List } from "lucide-react";
import { contractRequestRevision } from "@/entities/contract-request/model/contract-request";
import { ContractRequestDetail } from "@/entities/contract-request/ui/ContractRequestDetail";
import { contractRevision } from "@/entities/contract/model/contract";
import { ContractDetail } from "@/entities/contract/ui/ContractDetail";
import { NoticeDetail } from "@/entities/notice/ui/NoticeDetail";
import { openingResultNoticeKey } from "@/entities/opening-result/model/opening-result-display";
import { openingResultHeader } from "@/entities/opening-result/model/opening-result-header";
import { OpeningResultDetail } from "@/entities/opening-result/ui/OpeningResultDetail";
import { getNoticeOrderPlanNumber, orderPlanNoticeReferences } from "@/entities/order-plan/model/order-plan";
import { OrderPlanDetail } from "@/entities/order-plan/ui/OrderPlanDetail";
import { PriorSpecDetail } from "@/entities/prior-spec/ui/PriorSpecDetail";
import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import type { NumberWithRevision } from "@/shared/lib/g2b/revision-route";
import { Button } from "@/shared/ui/button";
import { userDetailPath, userListReturnHref } from "../config/routes";

async function savedNoticePaths(keys: NumberWithRevision[]) {
  const repository = getG2bRepository();
  const references = new Map(keys.map((key) => [userDetailPath("notices", key), key]));
  const paths = new Set<string>();
  await Promise.all(Array.from(references, async ([href, key]) => {
    if (await repository.find(key)) paths.add(href);
  }));
  return (key: NumberWithRevision) => {
    const href = userDetailPath("notices", key);
    return paths.has(href) ? href : undefined;
  };
}

async function loadDetail(section: CollectionSection, { number, revision = "" }: {
  number: string;
  revision?: string;
}) {
  if (g2bNumber(number) !== number) notFound();
  const repository = getG2bRepository();
  const key = { number, revision };
  const orderPlanPath = (number: string) => repository.findOrderPlan(number)
    ? userDetailPath("order-plans", { number, revision: "" })
    : undefined;
  const priorSpecPath = (number: string) => repository.findPriorSpec(number)
    ? userDetailPath("prior-specs", { number, revision: "" })
    : undefined;

  switch (section) {
    case "order-plans": {
      const plan = repository.findOrderPlan(number);
      if (!plan) notFound();
      // 공통 본문의 링크 함수는 동기이므로 연결된 공고의 저장 여부를 먼저 조회한다.
      const notices = orderPlanNoticeReferences(plan, repository.findNoticesForOrderPlan(number));
      const noticePath = await savedNoticePaths(notices);
      return <OrderPlanDetail
        plan={plan}
        notices={notices}
        priorSpecPath={priorSpecPath}
        noticePath={noticePath}
      />;
    }
    case "prior-specs": {
      const spec = repository.findPriorSpec(number);
      if (!spec) notFound();
      return <PriorSpecDetail spec={spec} orderPlanPath={orderPlanPath} />;
    }
    case "contract-requests": {
      if (contractRequestRevision(revision) !== revision) notFound();
      const contractRequest = repository.findContractRequest(key);
      if (!contractRequest) notFound();
      return <ContractRequestDetail contractRequest={contractRequest} />;
    }
    case "contracts": {
      if (contractRevision(revision) !== revision) notFound();
      const contract = repository.findContract(key);
      if (!contract) notFound();
      return <ContractDetail contract={contract} />;
    }
    case "notices": {
      if (!/^\d{3}$/.test(revision)) notFound();
      const notice = await repository.find(key);
      if (!notice) notFound();
      return <NoticeDetail
        notice={notice}
        orderPlanNumber={notice.orderPlanNumber ?? getNoticeOrderPlanNumber(notice.payload)}
        links={{
          orderPlanPath,
          priorSpecPath,
          contractPath: (reference) => repository.findContract(reference)
            ? userDetailPath("contracts", reference)
            : undefined,
          contractRequestPath: (reference) => repository.findContractRequest(reference)
            ? userDetailPath("contract-requests", reference)
            : undefined,
          openingResultPath: (reference) => repository.listOpeningResults(reference).length
            ? userDetailPath("opening-results", reference)
            : undefined,
        }}
      />;
    }
    case "opening-results": {
      if (!/^\d{3}$/.test(revision)) notFound();
      const results = repository.listOpeningResults(key);
      if (!results.length) notFound();
      const references = results.flatMap((result) => result.results.flatMap(({ query, detail }) => {
        const reference = openingResultNoticeKey(query, detail);
        return reference && (reference.number !== number || reference.revision !== revision) ? [reference] : [];
      }));
      const [notice, relatedNoticePath] = await Promise.all([repository.find(key), savedNoticePaths(references)]);
      const noticePath = (reference: NumberWithRevision) => {
        if (reference.number === number && reference.revision === revision) {
          return notice ? userDetailPath("notices", reference) : undefined;
        }
        return relatedNoticePath(reference);
      };
      return <OpeningResultDetail
        noticeKey={key}
        results={results}
        noticePath={noticePath}
        {...openingResultHeader(notice, results)}
      />;
    }
  }
}

/**
 * 저장된 사용자 상세를 열고 검증된 현재 업무의 목록으로 돌아가는 링크를 제공한다.
 * @throws 경로의 식별자가 유효하지 않거나 자료가 없으면 404 처리하고, 저장소 오류는 호출자에 전달한다.
 */
export async function G2bDetailPage({ section, params, searchParams }: {
  section: CollectionSection;
  params: Promise<{ number: string; revision?: string }>;
  searchParams: Promise<CollectionSearchParams>;
}) {
  const [key, { from }] = await Promise.all([params, searchParams]);
  const detail = await loadDetail(section, key);

  return (
    <main className="mx-auto grid w-full min-w-0 max-w-6xl gap-6 px-4 py-8 sm:px-6">
      <nav aria-label="상세 페이지 이동">
        <Button asChild variant="outline">
          <Link href={userListReturnHref(section, from)} prefetch={false}>
            <List aria-hidden="true" />
            목록으로 이동
          </Link>
        </Button>
      </nav>
      {section !== "notices" && <h1 className="sr-only">{G2B_SECTIONS[section]}</h1>}
      {detail}
    </main>
  );
}

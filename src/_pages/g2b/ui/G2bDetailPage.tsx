import { notFound } from "next/navigation";
import { contractRequestRevision } from "@/entities/contract-request/model/contract-request";
import { ContractRequestDetail } from "@/entities/contract-request/ui/ContractRequestDetail";
import { contractRevision } from "@/entities/contract/model/contract";
import { ContractDetail } from "@/entities/contract/ui/ContractDetail";
import { isMockNotice } from "@/entities/notice/model/notice-detail";
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
import { DetailNavigation } from "@/shared/ui/g2b/DetailNavigation";
import { userDetailPath, userListReturnHref } from "../config/routes";

async function savedNoticePaths(keys: NumberWithRevision[]) {
  const repository = getG2bRepository();
  const references = new Map(keys.map((key) => [userDetailPath("notices", key), key]));
  const paths = new Set<string>();
  await Promise.all(Array.from(references, async ([href, key]) => {
    const notice = await repository.find(key);
    if (notice && !isMockNotice(notice)) paths.add(href);
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
  const orderPlanPath = async (number: string) => (await repository.findOrderPlan(number))
    ? userDetailPath("order-plans", { number, revision: "" })
    : undefined;
  const priorSpecPath = async (number: string) => (await repository.findPriorSpec(number))
    ? userDetailPath("prior-specs", { number, revision: "" })
    : undefined;

  switch (section) {
    case "order-plans": {
      const plan = await repository.findOrderPlan(number);
      if (!plan) notFound();
      // 공통 본문의 링크 함수는 동기이므로 연결된 공고의 저장 여부를 먼저 조회한다.
      const notices = orderPlanNoticeReferences(plan, await repository.findNoticesForOrderPlan(number));
      const noticePath = await savedNoticePaths(notices);
      return <OrderPlanDetail
        plan={plan}
        notices={notices}
        priorSpecPath={priorSpecPath}
        noticePath={noticePath}
      />;
    }
    case "prior-specs": {
      const spec = await repository.findPriorSpec(number);
      if (!spec) notFound();
      return <PriorSpecDetail spec={spec} orderPlanPath={orderPlanPath} />;
    }
    case "contract-requests": {
      if (contractRequestRevision(revision) !== revision) notFound();
      const contractRequest = await repository.findContractRequest(key);
      if (!contractRequest) notFound();
      return <ContractRequestDetail contractRequest={contractRequest} />;
    }
    case "contracts": {
      if (contractRevision(revision) !== revision) notFound();
      const contract = await repository.findContract(key);
      if (!contract) notFound();
      return <ContractDetail contract={contract} />;
    }
    case "notices": {
      if (!/^\d{3}$/.test(revision)) notFound();
      const notice = await repository.find(key);
      if (!notice || isMockNotice(notice)) notFound();
      return <NoticeDetail
        notice={notice}
        orderPlanNumber={notice.orderPlanNumber ?? getNoticeOrderPlanNumber(notice.payload)}
        links={{
          noticePath: async (reference) => {
            const related = await repository.findUsableNotice(reference);
            return related && !isMockNotice(related) ? userDetailPath("notices", reference) : undefined;
          },
          orderPlanPath,
          priorSpecPath,
          contractPath: async (reference) => (await repository.findContract(reference))
            ? userDetailPath("contracts", reference)
            : undefined,
          contractRequestPath: async (reference) => (await repository.findContractRequest(reference))
            ? userDetailPath("contract-requests", reference)
            : undefined,
          openingResultPath: async (reference) => (await repository.listOpeningResults(reference)).length
            ? userDetailPath("opening-results", reference)
            : undefined,
        }}
      />;
    }
    case "opening-results": {
      if (!/^\d{3}$/.test(revision)) notFound();
      const results = await repository.listOpeningResults(key);
      if (!results.length) notFound();
      const references = results.flatMap((result) => result.results.flatMap(({ query, detail }) => {
        const reference = openingResultNoticeKey(query, detail);
        return reference && (reference.number !== number || reference.revision !== revision) ? [reference] : [];
      }));
      const [notice, relatedNoticePath] = await Promise.all([repository.find(key), savedNoticePaths(references)]);
      const noticePath = (reference: NumberWithRevision) => {
        if (reference.number === number && reference.revision === revision) {
          return notice && !isMockNotice(notice) ? userDetailPath("notices", reference) : undefined;
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
 * 저장된 사용자 상세를 열고 직전 기록과 검증된 업무 목록에 각각 연결한다.
 * @param props 업무 유형, 상세 키 및 일반 업무 목록에서 전달한 복귀 조건.
 * @returns 상세 본문과 공통 이동 버튼이 있는 회원 화면.
 * @throws 식별자가 유효하지 않거나 자료가 없거나 모의공고 상세를 요청하면 404 처리하고, 저장소 오류는 호출자에 전달한다.
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
      {/* 일반 업무 목록의 검색·필터·페이지 주소를 공통 이동 영역에 전달한다. */}
      <DetailNavigation listHref={userListReturnHref(section, from)} />
      {section !== "notices" && <h1 className="sr-only">{G2B_SECTIONS[section]}</h1>}
      {detail}
    </main>
  );
}

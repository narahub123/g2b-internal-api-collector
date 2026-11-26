import Link from "next/link";
import { BUSINESS_API_KINDS } from "@/entities/business/model/business-apis";
import { businessDisplayFields, businessSectionTitles, formatBusinessNumber } from "@/entities/business/model/business-display";
import type { openBusinessInformation } from "@/server/g2b/repository/business-information";
import { myPageMenuPath } from "@/shared/config/mypage";
import { Accordion } from "@/shared/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import { RefreshBusinessButton } from "@/features/business-information/ui/RefreshBusinessButton";
import { DeleteBusinessDialog } from "@/features/business-information/ui/DeleteBusinessDialog";
import { BusinessForm } from "./BusinessForm";

/** 소유 관계를 검증한 상세에서 화면에 전달하는 데이터다. */
type BusinessDetailData = NonNullable<Awaited<ReturnType<ReturnType<typeof openBusinessInformation>["detailForUser"]>>>;

/**
 * 선택한 사업자의 저장 결과와 7종 수집 상태를 상세 화면으로 표시한다.
 * @param props 선택 사업자의 ID와 인가 후 조회한 업무 데이터.
 * @returns 여러 영역을 함께 열 수 있는 상세와 목록 링크.
 */
export function BusinessDetail({ businessId, detail }: { businessId: number; detail: BusinessDetailData }) {
  // 재수집은 등록한 사업자에 실패나 미완료 유형이 있을 때만 제공한다.
  const canRetry = Object.values(detail.sections).some(({ status }) => status === "failed" || status === "incomplete");
  // 이미 조회한 기본정보에서 표시 가능한 업체명을 선택한다.
  const name = detail.sections.basic.items.map(({ corpNm }) =>
    typeof corpNm === "string" ? corpNm.trim() : "").find(Boolean) ?? null;

  // 서버에서 가져온 결과를 아코디언 자식으로 전달해 열기 동작에 별도 요청이 필요 없게 한다.
  return (
    <div className="grid min-w-0 gap-4">
      {/* 검색 조건이 없는 사업자 목록으로 명시적으로 돌아간다. */}
      <Link prefetch={false} href={myPageMenuPath("business")} className="w-fit text-sm font-medium hover:underline">
        사업자 목록으로
      </Link>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>사업자 정보 상세</CardTitle>
            <p className="text-sm text-muted-foreground">{formatBusinessNumber(detail.number)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
            {/* 현재 저장 상태와 관계없이 명시적으로 7종 갱신을 요청할 수 있다. */}
            <RefreshBusinessButton id={businessId} number={detail.number} />
            {/* 현재 상세 사업자의 등록 관계 해제를 공통 확인창에서 처리한다. */}
            <DeleteBusinessDialog id={businessId} name={name} number={detail.number} source="detail" />
          </div>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          {/* 실행권을 확보할 수 있는 업무가 있을 때 재시도 요청을 제공한다. */}
          {canRetry && <BusinessForm businessId={businessId} />}
          <Accordion type="multiple" className="min-w-0">
            {BUSINESS_API_KINDS.map((kind) => {
              // 업무 유형에 맞는 저장 행과 사용자용 수집 상태를 선택한다.
              const { items, status } = detail.sections[kind];
              const notice = status === "failed" ? "수집에 실패했습니다." :
                status === "running" ? "수집 중입니다." :
                status === "incomplete" ? "수집이 완료되지 않았습니다." :
                items.length ? null : "조회 결과가 없습니다.";
              // 실패 안내와 이전 저장 결과를 동시에 표시할 수 있다.
              return (
                <DetailAccordionSection key={kind} value={kind} title={businessSectionTitles[kind]}>
                  {notice && <p className="mb-2 text-sm text-muted-foreground">{notice}</p>}
                  <div className="grid gap-3">
                    {items.map((item, index) => (
                      // 행 단위로 업무 필드 순서를 보존하며 좁은 화면에서는 자동 줄바꿈한다.
                      <dl key={index} className="grid min-w-0 gap-x-4 gap-y-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">
                        {businessDisplayFields(kind, item).map(({ field, label, value }) => (
                          <div key={field} className="min-w-0">
                            <dt className="text-xs text-muted-foreground">{label}</dt>
                            <dd className="whitespace-pre-wrap break-words">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ))}
                  </div>
                </DetailAccordionSection>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

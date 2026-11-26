import Link from "next/link";
import type { CSSProperties } from "react";
import { BUSINESS_API_KINDS } from "@/entities/business/model/business-apis";
import {
  businessDisplayFields,
  businessDisplayEmptySlots,
  businessSectionTitles,
  formatBusinessNumber,
} from "@/entities/business/model/business-display";
import type { openBusinessInformation } from "@/server/g2b/repository/business-information";
import { myPageMenuPath } from "@/shared/config/mypage";
import { Accordion } from "@/shared/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import { RefreshBusinessButton } from "@/features/business-information/ui/RefreshBusinessButton";
import { DeleteBusinessDialog } from "@/features/business-information/ui/DeleteBusinessDialog";
import { BusinessForm } from "./BusinessForm";

/** 소유 관계를 검증한 상세에서 화면에 전달하는 데이터다. */
type BusinessDetailData = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof openBusinessInformation>["detailForUser"]>
  >
>;

/**
 * 선택한 사업자의 저장 결과와 7종 수집 상태를 상세 화면으로 표시한다.
 * @param props 선택 사업자의 ID와 인가 후 조회한 업무 데이터.
 * @returns 여러 영역을 함께 열 수 있는 상세와 목록 링크.
 */
export function BusinessDetail({
  businessId,
  detail,
}: {
  businessId: number;
  detail: BusinessDetailData;
}) {
  // 재수집은 등록한 사업자에 실패나 미완료 유형이 있을 때만 제공한다.
  const canRetry = Object.values(detail.sections).some(
    ({ status }) => status === "failed" || status === "incomplete",
  );
  // 이미 조회한 기본정보에서 표시 가능한 업체명을 선택한다.
  const name =
    detail.sections.basic.items
      .map(({ corpNm }) => (typeof corpNm === "string" ? corpNm.trim() : ""))
      .find(Boolean) ?? null;

  // 서버에서 가져온 결과를 아코디언 자식으로 전달해 열기 동작에 별도 요청이 필요 없게 한다.
  return (
    <div className="grid min-w-0 gap-4">
      {/* 검색 조건이 없는 사업자 목록으로 명시적으로 돌아간다. */}
      <Link
        prefetch={false}
        href={myPageMenuPath("business")}
        className="w-fit text-sm font-medium hover:underline"
      >
        사업자 목록으로
      </Link>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>사업자 정보 상세</CardTitle>
            <p className="text-sm text-muted-foreground">
              {formatBusinessNumber(detail.number)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
            {/* 현재 저장 상태와 관계없이 명시적으로 7종 갱신을 요청할 수 있다. */}
            <RefreshBusinessButton id={businessId} number={detail.number} />
            {/* 현재 상세 사업자의 등록 관계 해제를 공통 확인창으로 처리한다. */}
            <DeleteBusinessDialog
              id={businessId}
              name={name}
              number={detail.number}
              source="detail"
            />
          </div>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          {/* 실행권을 확보할 수 있는 업무가 있을 때 재시도 요청을 제공한다. */}
          {canRetry && <BusinessForm businessId={businessId} />}
          <Accordion type="multiple" className="min-w-0">
            {BUSINESS_API_KINDS.map((kind) => {
              // 업무 유형에 맞는 저장 행과 사용자용 수집 상태를 선택한다.
              const { items, status } = detail.sections[kind];
              const notice =
                status === "failed"
                  ? "수집에 실패했습니다."
                  : status === "running"
                    ? "수집 중입니다."
                    : status === "incomplete"
                      ? "수집이 완료되지 않았습니다."
                      : items.length
                        ? null
                        : "조회 결과가 없습니다.";

              // 업무별 화면 배치 전용 빈칸의 위치를 선택한다.
              const emptySlots = businessDisplayEmptySlots(kind);

              // 실패 안내와 이전 저장 결과를 동시에 표시할 수 있다.
              return (
                <DetailAccordionSection
                  key={kind}
                  value={kind}
                  title={businessSectionTitles[kind]}
                >
                  {notice && (
                    <p className="mb-2 text-sm text-muted-foreground">
                      {notice}
                    </p>
                  )}
                  <div className="grid gap-3">
                    {items.map((item, index) => (
                      // 행 단위로 업무 필드를 표시하며 화면 크기에 따라 배치 순서와 열 개수를 적용한다.
                      <dl
                        key={index}
                        className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 rounded-md border p-3 sm:grid-cols-12"
                      >
                        {businessDisplayFields(kind, item).map(
                          ({
                            field,
                            label,
                            value,
                            order1,
                            order2,
                            order3,
                            span2,
                            span3,
                          }) => (
                            <div
                              key={field}
                              className={`min-w-0 ${order1 < 0 ? "hidden" : "block"} ${order2 < 0 ? "sm:hidden" : "sm:block"} ${order3 < 0 ? "lg:hidden" : "lg:block"} order-[var(--field-order-1)] sm:order-[var(--field-order-2)] lg:order-[var(--field-order-3)] sm:col-span-[var(--field-span-2)] lg:col-span-[var(--field-span-3)]`}
                              style={
                                {
                                  "--field-order-1": order1,
                                  "--field-order-2": order2,
                                  "--field-order-3": order3,
                                  "--field-span-2": span2,
                                  "--field-span-3": span3,
                                } as CSSProperties
                              }
                            >
                              <dt className="text-xs text-muted-foreground">
                                {label}
                              </dt>
                              <dd className="whitespace-pre-wrap break-words">
                                {field === "hmpgAdrs" &&
                                resolveHomepageUrl(value) ? (
                                  <a
                                    href={resolveHomepageUrl(value)!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary underline underline-offset-4"
                                  >
                                    {value}
                                  </a>
                                ) : (
                                  value
                                )}
                              </dd>
                            </div>
                          ),
                        )}

                        {/* 2열 화면에서만 배치 전용 빈칸을 표시한다. */}
                        {emptySlots.columns2.map((order) => (
                          <div
                            key={`empty-2-${order}`}
                            aria-hidden="true"
                            className="hidden sm:block sm:col-span-6 sm:order-[var(--field-order-2)] lg:hidden"
                            style={
                              {
                                "--field-order-2": order,
                              } as CSSProperties
                            }
                          >
                            <dt className="sr-only">빈칸</dt>
                            <dd />
                          </div>
                        ))}

                        {/* 3열 화면에서만 배치 전용 빈칸을 표시한다. */}
                        {emptySlots.columns3.map((order) => (
                          <div
                            key={`empty-3-${order}`}
                            aria-hidden="true"
                            className="hidden lg:block lg:col-span-4 lg:order-[var(--field-order-3)]"
                            style={
                              {
                                "--field-order-3": order,
                              } as CSSProperties
                            }
                          >
                            <dt className="sr-only">빈칸</dt>
                            <dd />
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

/**
 * 홈페이지 주소를 외부 링크로 사용할 수 있는 URL로 변환한다.
 * @param value 홈페이지 주소.
 * @returns 유효한 HTTP 또는 HTTPS URL.
 */
function resolveHomepageUrl(value: string) {
  const text = value.trim();

  if (!text || text === "—") return null;

  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`,
    );

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

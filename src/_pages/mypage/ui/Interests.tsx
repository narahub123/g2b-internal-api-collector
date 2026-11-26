import { verifyCurrentUser } from "@/server/auth/current-user";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openInterests } from "@/server/g2b/repository/interests";
import { isInterestType } from "@/shared/model/g2b/interest";
import { InterestList } from "./InterestList";

/**
 * 마이페이지 주소에서 유형과 페이지를 확인해 로그인 사용자의 관심 목록을 준비한다.
 * @param props.searchParams URL의 업무 유형과 페이지 번호.
 * @returns 등록 업무 유형과 목록 조작 UI가 있는 관심 화면.
 * @throws DB에서 관심 목록을 조회하지 못한 경우.
 */
export default async function Interests({ searchParams }: {
  searchParams: Promise<{ type?: string | string[]; page?: string | string[] }>;
}) {
  // 페이지 가드에서 확인한 동일 요청의 사용자와 주소 조건을 사용한다.
  const [auth, query] = await Promise.all([verifyCurrentUser(), searchParams]);
  if (auth.status !== "authenticated") return null;
  // 알 수 없는 유형과 중복된 주소 조건은 전체 목록으로 처리한다.
  const type = isInterestType(query.type) ? query.type : undefined;
  // 양의 안전한 정수만 페이지로 처리하고 그 외에는 첫 페이지로 재설정한다.
  const parsedPage = typeof query.page === "string" && /^\d+$/.test(query.page) ? Number(query.page) : 1;
  const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  // 원본 업무에는 접근하지 않고 사용자와 유형으로 관심 테이블만 조회한다.
  const result = await openInterests(getG2bDatabase()).list(auth.user.id, type, requestedPage);

  // 페이지나 유형이 바뀌면 이전 화면의 선택 상태를 제거한다.
  return (
    <section className="grid min-w-0 gap-4">
      <h2 className="text-xl font-semibold">관심</h2>
      <InterestList key={`${type ?? "all"}/${requestedPage}/${result.page}`} type={type} requestedPage={requestedPage} {...result} />
    </section>
  );
}

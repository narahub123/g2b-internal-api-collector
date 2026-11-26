import { verifyCurrentUser } from "@/server/auth/current-user";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openInterests, parseInterestKey } from "@/server/g2b/repository/interests";
import type { InterestKey } from "@/shared/model/g2b/interest";
import { InterestButton } from "./InterestButton";

/**
 * 사용자와 관리자 상세에서 같은 방식으로 현재 사용자의 별 상태를 준비한다.
 * @param props.item 표시 중인 원본의 업무 식별자.
 * @returns 원본을 회원 상세에서 열 수 있고 사용자 인증이 확인되면 관심 버튼.
 * @throws 관심 상태를 DB에서 읽을 수 없는 경우.
 */
export async function DetailInterest({ item }: { item: InterestKey }) {
  // 관리자 상세에만 들어갈 수 있는 비표준 키는 회원용 관심 링크로 저장하지 않는다.
  const key = parseInterestKey(item);
  if (!key) return null;
  // 페이지 접근 시 확인한 사용자 정보를 같은 서버 렌더링에서 재사용한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return null;
  // 현재 사용자와 업무의 전체 키를 사용해 초기 상태를 읽는다.
  const subscribed = await openInterests(getG2bDatabase()).has(auth.user.id, key);
  // 원본 제목이나 사용자 ID를 브라우저에서 다시 보내지 않도록 키와 표시 상태만 전달한다.
  return <InterestButton item={key} subscribed={subscribed} />;
}

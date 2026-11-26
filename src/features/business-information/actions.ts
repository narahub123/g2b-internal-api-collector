"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openBusinessInformation } from "@/server/g2b/repository/business-information";
import {
  myPageBusinessPath,
  myPageMenuPath,
  parseMyPageBusinessId,
} from "@/shared/config/mypage";
import {
  BusinessNotRegisteredError,
  getBusinessRegistration,
  normalizeBusinessNumber,
} from "./server/registration";

/**
 * 현재 사용자가 등록한 사업자의 전체 정보를 명시적 요청으로 갱신한다.
 * @param businessId 화면에서 선택한 내부 ID.
 * @param number 화면에 표시한 원본 사업자등록번호.
 * @returns 현재 화면에 표시할 갱신 결과 또는 접근 안내.
 */
export async function refreshMyBusiness(businessId: string, number: string) {
  // 직접 제출된 서버 요청에도 현재 사용자 세션을 요구한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return "로그인 상태를 확인해 주세요.";

  // 화면에 표시한 형식과 일치하는 식별값으로만 조회를 시작한다.
  const id = parseMyPageBusinessId(businessId);
  if (
    id === undefined ||
    typeof number !== "string" ||
    !/^\d{10}$/.test(number)
  ) {
    return "등록된 사업자를 확인해 주세요.";
  }

  try {
    // 기존 서비스에서 관계와 등록번호를 확인한 뒤 전체 실행권을 확보한다.
    const result = await getBusinessRegistration().refresh(
      auth.user.id,
      id,
      number,
    );
    if (result.status === "busy")
      return "이 사업자의 정보를 수집 중입니다. 완료 후 다시 시도해 주세요.";

    // 실패 상태와 정상 빈 결과도 목록 및 상세의 다음 조회에 반영한다.
    revalidatePath(myPageMenuPath("business"));
    revalidatePath(myPageBusinessPath(id));
    if (result.saved === result.total) return "전체 정보를 갱신했습니다.";
    if (result.saved === 0) return "사업자 정보 갱신을 완료하지 못했습니다.";
    return `정보 ${result.total}종 중 ${result.saved}종을 갱신했습니다. 나머지 정보는 상세에서 확인해 주세요.`;
  } catch (error) {
    // 관계가 없는 요청에는 다른 사업자의 존재 여부나 수집 상태를 공개하지 않는다.
    if (error instanceof BusinessNotRegisteredError)
      return "등록된 사업자를 확인해 주세요.";
    return "사업자 정보 갱신을 완료하지 못했습니다.";
  }
}

/**
 * 인증된 사용자가 확인한 사업자 등록 관계를 해제하고 목록을 갱신한다.
 * @param businessId 확인한 행의 내부 사업자 ID 문자열.
 * @param number 확인한 행의 정규화 사업자등록번호.
 * @param source 상세에서 성공 후 목록으로 복귀할지 결정하는 호출 화면.
 * @returns 목록에서 성공하면 빈 문자열, 실패하면 확인창에 표시할 문구.
 * @throws 상세에서 삭제를 완료하면 목록으로 이동하는 Next.js 신호를 전달한다.
 */
export async function deleteMyBusiness(businessId: string, number: string, source: "list" | "detail" = "list") {
  // 브라우저가 제출한 사용자 정보 없이 현재 세션으로 삭제 권한을 확인한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return "로그인 상태를 확인해 주세요.";

  // 목록과 상세에서 전달하는 형식과 일치하는 ID 및 번호만 저장소에 전달한다.
  const id = parseMyPageBusinessId(businessId);
  if (
    id === undefined ||
    typeof number !== "string" ||
    !/^\d{10}$/.test(number)
  ) {
    return "삭제할 사업자를 확인해 주세요.";
  }

  try {
    // 관계가 이미 해제됐거나 일치하지 않아도 동일하게 목록을 최신 상태로 갱신한다.
    await openBusinessInformation(getG2bDatabase()).removeRegistration(
      auth.user.id,
      id,
      number,
    );
    revalidatePath(myPageMenuPath("business"));
    revalidatePath(myPageBusinessPath(id));
  } catch {
    // 내부 DB 오류는 화면에 노출하지 않고 다시 시도할 수 있도록 안내한다.
    return "삭제하지 못했습니다. 다시 시도해 주세요.";
  }

  // 상세는 삭제된 주소를 탐색 기록에 남기지 않고 갱신된 목록으로 이동한다.
  if (source === "detail") redirect(myPageMenuPath("business"), RedirectType.replace);
  // 목록 호출은 현재 화면에서 확인창을 닫을 수 있게 완료를 돌려준다.
  return "";
}

/**
 * 인증된 사용자의 사업자 등록과 최초 수집을 실행한다.
 * @param _previous 폼의 직전 안내 문구.
 * @param form 사용자가 제출한 사업자등록번호.
 * @returns 화면에 표시할 처리 안내.
 */
export async function registerMyBusiness(_previous: string, form: FormData) {
  // 화면을 거치지 않은 호출도 현재 사용자 세션을 검증한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return "로그인 상태를 확인해 주세요.";

  // 입력 오류만 사용자에게 안내하고 수집기나 저장소의 오류 원문은 반환하지 않는다.
  const input = form.get("number");
  let number: string;
  try {
    number = normalizeBusinessNumber(typeof input === "string" ? input : "");
  } catch {
    return "사업자등록번호 10자리를 확인해 주세요.";
  }

  try {
    // 등록 관계를 저장하고 수집한 후 현재 목록과 해당 상세를 갱신한다.
    const id = await getBusinessRegistration().register(auth.user.id, number);
    revalidatePath(myPageBusinessPath(id));
    return "사업자를 등록했습니다. 수집 결과는 상세에서 확인할 수 있습니다.";
  } catch {
    // 등록 이후 수집 상태 저장에서 실패했을 수도 있으므로 갱신된 목록을 표시한다.
    return "등록 또는 수집 처리를 완료하지 못했습니다. 목록을 확인해 주세요.";
  } finally {
    // 등록 관계가 반영됐는지 목록에서 확인할 수 있게 한다.
    revalidatePath(myPageMenuPath("business"));
  }
}

/**
 * 현재 사용자가 등록한 사업자의 실패·미완료 수집을 다시 시도한다.
 * @param _previous 폼의 직전 안내 문구.
 * @param form 상세 화면이 제출한 내부 사업자 ID.
 * @returns 화면에 표시할 처리 안내.
 */
export async function retryMyBusiness(_previous: string, form: FormData) {
  // 요청마다 인증하고 브라우저가 제출한 ID의 형식을 검사한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return "로그인 상태를 확인해 주세요.";
  const id = parseMyPageBusinessId(form.get("businessId"));
  if (id === undefined) return "등록된 사업자를 확인해 주세요.";

  // 종료 상태는 서비스의 오류 종류에 따라 화면 안내로 변환한다.
  let message: string;
  try {
    // 기존 서비스가 같은 트랜잭션에서 등록 관계를 검증한 뒤 재시도할 API를 할당한다.
    await getBusinessRegistration().retry(auth.user.id, id);
    message = "재시도를 마쳤습니다. 아래 수집 결과를 확인해 주세요.";
  } catch (error) {
    // 등록 관계가 없으면 다른 사업자의 화면을 갱신하기 전에 종료한다.
    if (error instanceof BusinessNotRegisteredError)
      return "등록된 사업자를 확인해 주세요.";
    // 저장 오류가 발생한 경우에도 화면에 반영할 부분 결과가 있을 수 있다.
    message = "재시도를 완료하지 못했습니다. 수집 결과를 확인해 주세요.";
  }
  // 부분 성공한 결과와 바뀐 업체명이 현재 상세와 목록에 반영되게 한다.
  revalidatePath(myPageBusinessPath(id));
  revalidatePath(myPageMenuPath("business"));
  // 서버의 처리 결과만 반환하고 오류 원문은 화면에 전달하지 않는다.
  return message;
}

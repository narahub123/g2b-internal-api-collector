"use server";

import { revalidatePath } from "next/cache";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { myPageBusinessPath, myPageMenuPath, parseMyPageBusinessId } from "@/shared/config/mypage";
import { BusinessNotRegisteredError, getBusinessRegistration, normalizeBusinessNumber } from "./server/registration";

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
    if (error instanceof BusinessNotRegisteredError) return "등록된 사업자를 확인해 주세요.";
    // 저장 오류가 발생한 경우에도 화면에 반영할 부분 결과가 있을 수 있다.
    message = "재시도를 완료하지 못했습니다. 수집 결과를 확인해 주세요.";
  }
  // 부분 성공한 결과와 바뀐 업체명이 현재 상세와 목록에 반영되게 한다.
  revalidatePath(myPageBusinessPath(id));
  revalidatePath(myPageMenuPath("business"));
  // 서버의 처리 결과만 반환하고 오류 원문은 화면에 전달하지 않는다.
  return message;
}

import { verifyCurrentUser } from "@/server/auth/current-user";
import { PROFILE_UPLOAD_LIMIT, ProfileInputError, saveProfile } from "@/server/auth/profile";
import { openProfileStorage } from "@/server/auth/profile-storage";
import { openAuthRepository } from "@/server/auth/repository";
import { getG2bDatabase } from "@/server/g2b/repository";

/** 파일 외에 닉네임과 멀티파트 헤더가 차지할 수 있는 최대 크기. */
const requestLimit = PROFILE_UPLOAD_LIMIT + 16 * 1024;

/**
 * 파일을 해석하기 전에 스트림에서 받은 전체 요청 크기를 제한한다.
 * @param request 브라우저의 프로필 폼 요청.
 * @returns 닉네임과 선택 파일이 담긴 폼 데이터.
 * @throws 요청 크기 또는 폼 형식이 잘못되었을 때 오류를 발생시킨다.
 */
async function readProfileForm(request: Request) {
  // 멀티파트 본문과 길이 제한을 먼저 확인한다.
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data;") || !request.body) {
    throw new ProfileInputError("프로필 폼을 다시 제출해 주세요.");
  }
  if (Number(request.headers.get("content-length")) > requestLimit) {
    throw new ProfileInputError("4 MiB 이하의 이미지 파일을 선택해 주세요.");
  }
  // 길이 헤더가 생략되거나 부정확해도 초과 본문을 모두 읽지 않는다.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const piece = await reader.read();
      if (piece.done) break;
      received += piece.value.byteLength;
      if (received > requestLimit) {
        await reader.cancel();
        throw new ProfileInputError("4 MiB 이하의 이미지 파일을 선택해 주세요.");
      }
      chunks.push(piece.value);
    }
    // 허용 범위에 들어온 요청만 멀티파트로 디코딩한다.
    return await new Response(new Blob([Uint8Array.from(Buffer.concat(chunks))]), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch (error) {
    // 파싱 오류에는 파일 내용이나 내부 오류를 반환하지 않는다.
    if (error instanceof ProfileInputError) throw error;
    throw new ProfileInputError("프로필 폼을 다시 제출해 주세요.");
  } finally {
    // 요청에서 더 이상 본문을 사용하지 않는다.
    reader.releaseLock();
  }
}

/**
 * 같은 출처에서 제출한 회원의 닉네임과 선택 프로필 파일을 저장한다.
 * @param request 폼, 요청 출처 및 인증 쿠키를 제공하는 웹 요청.
 * @returns 저장 결과 또는 입력·인증·충돌·인프라 오류 상태.
 */
export async function POST(request: Request) {
  // 브라우저의 다른 출처 폼에서 로그인 쿠키로 변경을 요청하지 못하게 한다.
  const serviceOrigin = new URL(process.env.AUTH_URL || request.url).origin;
  if (request.headers.get("origin") !== serviceOrigin) {
    return Response.json({ error: "이 사이트에서 프로필을 다시 제출해 주세요." }, { status: 403 });
  }
  // 세션 ID로 읽은 최신 DB 상태를 사용하고 폼에서 사용자 ID를 받지 않는다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") {
    const expired = auth.status === "unauthenticated";
    return Response.json({ error: expired ? "로그인 후 다시 시도해 주세요." : "잠시 후 다시 시도해 주세요." },
      { status: expired ? 401 : 503 });
  }
  try {
    // 검증된 사용자만 이미지 본문을 해석하고 저장소에 접근한다.
    const form = await readProfileForm(request);
    const nickname = form.get("nickname");
    const image = form.get("image");
    if (typeof nickname !== "string" || typeof image === "string") {
      throw new ProfileInputError("닉네임과 프로필 이미지 입력을 확인해 주세요.");
    }
    // 파일을 선택하지 않은 브라우저 폼은 닉네임만 저장한다.
    const file = image?.name || image?.size ? Buffer.from(await image.arrayBuffer()) : undefined;
    const saved = await saveProfile(openAuthRepository(getG2bDatabase()), openProfileStorage, {
      userId: auth.user.id, previousImage: auth.state.image, nickname, file,
    });
    // 동시에 다른 프로필 저장이 앞서 완료되면 다시 불러올 수 있게 안내한다.
    if (!saved) return Response.json({ error: "프로필이 변경됐습니다. 화면을 새로 고친 후 다시 시도해 주세요." }, { status: 409 });
    return Response.json({ ok: true });
  } catch (error) {
    // 검증 오류만 사용자에게 전달하고 인프라 오류는 종류만 서버에 기록한다.
    if (error instanceof ProfileInputError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[프로필 저장]", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}

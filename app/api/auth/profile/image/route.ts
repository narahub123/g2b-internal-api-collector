import { verifyCurrentUser } from "@/server/auth/current-user";
import { parseProfileImageKey } from "@/server/auth/profile";
import { openProfileStorage } from "@/server/auth/profile-storage";

/**
 * 현재 로그인 사용자가 여전히 참조하는 버전의 이미지를 비공개 버킷에서 제공한다.
 * @param request 화면에서 사용하는 이미지 버전 주소와 세션을 포함한 요청.
 * @returns 로그인한 소유자의 WebP 또는 캐시하지 않는 오류 응답.
 */
export async function GET(request: Request) {
  // 오류나 접근 거절 응답은 브라우저에 저장하지 않는다.
  const errorHeaders = { "Cache-Control": "no-store" };
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") {
    return new Response(null, { status: auth.status === "error" ? 503 : 401, headers: errorHeaders });
  }
  // 사용자가 제공한 객체 경로로 접근할 수 없도록 DB의 현행 이미지에서만 객체 키를 가져온다.
  const key = auth.state.image;
  const image = parseProfileImageKey(key);
  const version = new URL(request.url).searchParams.get("v");
  if (!key || !image || image.owner !== auth.user.id || image.version !== version) {
    return new Response(null, { status: 404, headers: errorHeaders });
  }
  try {
    // 접근할 수 있는 현행 이미지에만 R2 요청을 보낸다.
    const bytes = await openProfileStorage().read(key);
    if (!bytes) return new Response(null, { status: 404, headers: errorHeaders });
    // 공유 캐시를 제외하고 동일 브라우저에서만 해당 버전을 최대 5분간 재사용한다.
    return new Response(new Blob([Uint8Array.from(bytes)]), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
    });
  } catch (error) {
    // 스토리지 오류에서 내부 주소와 자격 증명을 노출하지 않는다.
    console.error("[프로필 이미지 읽기]", error instanceof Error ? error.name : "UnknownError");
    return new Response(null, { status: 503, headers: errorHeaders });
  }
}

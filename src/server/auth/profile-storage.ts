import { v2 as cloudinary } from "cloudinary";
import { parseProfileImageKey, PROFILE_IMAGE_PREFIX } from "./profile";

/** 프로필 파일의 Cloudinary 리소스 및 접근 유형. */
const delivery = { resource_type: "image", type: "authenticated" } as const;
/** 서명된 서버 간 다운로드 주소가 유효한 시간(초). */
const downloadLifetime = 60;

/**
 * Turso에 저장하는 WebP 경로를 Cloudinary 이미지 식별자로 변환한다.
 * @param key 내부 사용자와 버전을 포함한 프로필 객체 경로.
 * @returns Cloudinary에서 확장자 없이 관리하는 public ID.
 * @throws 서비스가 관리하는 경로 형식이 아닌 경우.
 */
function publicIdFor(key: string) {
  // 임의의 외부 자산을 다운로드하거나 삭제하지 않게 관리 경로만 허용한다.
  if (!parseProfileImageKey(key)) throw new Error("프로필 이미지 경로가 올바르지 않습니다.");
  return key.slice(0, -".webp".length);
}

/**
 * 환경에서 서버 자격 증명을 읽어 인증된 Cloudinary 이미지 저장소를 연다.
 * @returns 이미지 업로드·읽기·삭제와 정리용 목록을 제공하는 저장소.
 * @throws Cloudinary 서버 설정이 누락되었거나 클라우드 이름이 잘못된 경우.
 */
export function openProfileStorage() {
  // 계정 자격 증명은 이미지를 다루는 서버 작업에서만 읽는다.
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !/^[a-zA-Z0-9_-]+$/.test(CLOUDINARY_CLOUD_NAME)
      || !CLOUDINARY_API_KEY?.trim() || !CLOUDINARY_API_SECRET?.trim()) {
    throw new Error("프로필 이미지 Cloudinary 설정이 필요합니다.");
  }
  // 업로드, 서명과 Admin API가 동일한 제품 환경을 사용하도록 설정한다.
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET,
    secure: true, upload_prefix: "https://api.cloudinary.com",
  });
  return {
    /**
     * 변환이 끝난 파일로 새 비공개 Cloudinary 이미지를 만든다.
     * @param key DB에서 참조할 신규 프로필 경로.
     * @param bytes 검증과 변환을 마친 WebP 데이터.
     * @throws 업로드에 실패하거나 새 자산이 만들어지지 않은 경우.
     */
    async put(key: string, bytes: Buffer) {
      // 경로의 소유자와 버전을 Cloudinary public ID에 그대로 반영한다.
      const publicId = publicIdFor(key);
      await new Promise<void>((resolve, reject) => {
        // 충돌 시 다른 파일을 덮어쓰지 않고, 서버에서 서명해 인증된 자산으로 저장한다.
        const stream = cloudinary.uploader.upload_stream({
          ...delivery, public_id: publicId, overwrite: false, format: "webp",
        }, (error, result) => {
          // 요청한 ID로 새 업로드가 확인된 경우에만 DB에서 이 경로를 참조할 수 있다.
          if (error || result?.public_id !== publicId || result.existing) {
            reject(new Error("Cloudinary 프로필 이미지 업로드 실패"));
            return;
          }
          resolve();
        });
        // 변환본을 추가 파일 생성 없이 SDK로 전송한다.
        stream.end(bytes);
      });
    },

    /**
     * 사용자와 현재 버전 확인이 끝난 이미지를 서버 전용 서명 요청으로 읽는다.
     * @param key 현재 DB가 참조하는 프로필 이미지 경로.
     * @returns 이미지 바이트 또는 공급자가 파일 누락을 응답하면 undefined.
     * @throws 권한 또는 공급자 응답 오류가 발생한 경우.
     */
    async read(key: string) {
      // 기존 앱 경로에서만 이미지를 제공하기 위해 다운로드 주소는 브라우저에 전달하지 않는다.
      const url = cloudinary.utils.private_download_url(publicIdFor(key), "webp", {
        ...delivery, expires_at: Math.floor(Date.now() / 1000) + downloadLifetime,
      });
      // 서버의 공유 캐시를 우회하고 응답 수신 시간과 다른 출처로의 리다이렉트를 제한한다.
      const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error("Cloudinary 프로필 이미지 조회 실패 (" + response.status + ")");
      // 앱의 인증 응답에서 원본 WebP를 제공할 수 있게 바이트를 돌려준다.
      return new Uint8Array(await response.arrayBuffer());
    },

    /**
     * DB에서 참조되지 않는 인증된 이미지 한 건을 삭제한다.
     * @param key 서비스가 발급한 프로필 객체 경로.
     * @throws 삭제 실패 시 오류를 전달해 이후 정리 작업에서 재시도할 수 있게 한다.
     */
    async remove(key: string) {
      // 인증된 유형을 지정하고 이미 없어진 자산도 정리 완료로 처리한다.
      const result = await cloudinary.uploader.destroy(publicIdFor(key), { ...delivery, invalidate: true });
      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error("Cloudinary 프로필 이미지 삭제 실패");
      }
    },

    /**
     * 관리 대상 이미지의 경로와 생성 시각을 페이지 단위로 제공한다.
     * @yields Turso와 동일한 형태의 이미지 경로 및 생성 시각.
     * @throws Admin API 목록 조회에 실패한 경우.
     */
    async *list() {
      // 다음 페이지가 있을 때만 해당 커서로 이어서 조회한다.
      let cursor: string | undefined;
      do {
        // 인증된 이미지 중 프로필 접두사에 속하는 데이터만 조회한다.
        const page = await cloudinary.api.resources({ ...delivery, prefix: PROFILE_IMAGE_PREFIX, next_cursor: cursor });
        for (const asset of page.resources) {
          // 변환본의 확장자를 복원해 DB 참조 경로와 직접 비교할 수 있게 한다.
          if (asset.format !== "webp" || typeof asset.public_id !== "string") continue;
          const key = asset.public_id + ".webp";
          const createdAt = new Date(asset.created_at);
          if (parseProfileImageKey(key) && Number.isFinite(createdAt.getTime())) yield { key, createdAt };
        }
        cursor = page.next_cursor;
      } while (cursor);
    },
  };
}

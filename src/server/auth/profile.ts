import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { openAuthRepository } from "./repository";

/** 요청에서 받는 원본 파일의 최대 크기. */
export const PROFILE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** 버킷에서 프로필 파일만 조회하는 공통 접두사. */
export const PROFILE_IMAGE_PREFIX = "profile-images/";
/** 현재 사용자 기준으로 바꿀 수 있는 프로필 필드. */
type ProfileRepository = Pick<ReturnType<typeof openAuthRepository>, "updateProfile">;
/** 이미지 교체에서 필요한 객체 저장소 동작. */
type ProfileStorage = {
  // WebP 바이트를 사용자가 소유할 새 키에 저장한다.
  put(key: string, bytes: Buffer): Promise<void>;
  // DB에서 분리된 키를 버킷에서 정리한다.
  remove(key: string): Promise<void>;
};

/** 형식·용량 위반을 인프라 오류와 구분하는 입력 오류. */
export class ProfileInputError extends Error {}

/**
 * 내부 ID를 객체 경로 한 구간에 넣을 수 있는 이름으로 변환한다.
 * @param userId 검증된 내부 사용자 ID.
 * @returns 해당 사용자 객체의 고정 디렉터리.
 */
function ownerPrefix(userId: string) {
  // ID의 문자와 관계없이 경로 구분자가 포함되지 않게 인코딩한다.
  return PROFILE_IMAGE_PREFIX + Buffer.from(userId).toString("base64url") + "/";
}

/**
 * 저장 경로가 관리되는 프로필 객체인지 검증하고 소유자를 복원한다.
 * @param key DB에서 읽었거나 버킷에서 나열한 객체 키.
 * @returns 소유자와 버전 또는 관리 대상이 아닌 경우 null.
 */
export function parseProfileImageKey(key: string | null) {
  // OAuth URL 등 기존 문자열은 관리되는 객체에서 제외한다.
  const match = key?.match(/^profile-images\/([A-Za-z0-9_-]+)\/([0-9a-f-]{36})\.webp$/);
  if (!match) return null;
  // 다시 인코딩해 경로 이름이 해당 소유자의 표준 표현인지 확인한다.
  const owner = Buffer.from(match[1], "base64url").toString("utf8");
  return owner && ownerPrefix(owner) === PROFILE_IMAGE_PREFIX + match[1] + "/" ? { owner, version: match[2] } : null;
}

/**
 * 저장된 이미지 값을 브라우저에서 읽을 수 있는 주소로 변환한다.
 * @param image 기존 제공자 URL 또는 내부 객체 키.
 * @returns 기존 URL 또는 버전이 포함된 인증 이미지 URL.
 */
export function profileImageUrl(image: string | null) {
  // 브라우저에 객체 키를 전달하지 않고 사용자 세션에 귀속된 이미지 API를 사용한다.
  const item = parseProfileImageKey(image);
  return item ? "/api/auth/profile/image?v=" + item.version : image;
}

/**
 * 바이너리를 실제 이미지로 디코딩하고 메타데이터 없는 작은 WebP를 생성한다.
 * @param input 최대 4 MiB의 JPEG·PNG·WebP 원본.
 * @returns 긴 변 최대 512 픽셀 및 최대 256 KiB의 이미지.
 * @throws 허용되지 않는 형식, 손상, 디코딩 크기 또는 용량 제한 위반.
 */
export async function encodeProfileImage(input: Buffer): Promise<Buffer> {
  // 파일명과 요청 MIME 대신 실제 디코더의 형식을 검증한다.
  if (!input.length || input.length > PROFILE_UPLOAD_LIMIT) {
    throw new ProfileInputError("4 MiB 이하의 이미지 파일을 선택해 주세요.");
  }
  try {
    // 최대 40메가픽셀만 디코딩하고 회전 정보를 이미지 픽셀에 적용한다.
    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: "warning" });
    const { format, pages } = await image.metadata();
    if (!format || !["jpeg", "png", "webp"].includes(format) || (pages ?? 1) > 1) {
      throw new ProfileInputError("JPEG, PNG, WebP 정지 이미지를 선택해 주세요.");
    }
    // 용량을 초과하면 품질과 해상도를 낮춰 원본에서 다시 변환한다.
    for (const [size, quality] of [[512, 82], [512, 65], [384, 55], [256, 45]]) {
      const encoded = await image.clone().autoOrient().resize(size, size, {
        fit: "inside", withoutEnlargement: true,
      }).webp({ quality }).toBuffer();
      if (encoded.length <= 256 * 1024) return encoded;
    }
  } catch (error) {
    // 사용자에게 인코더 내부 오류 대신 선택한 파일의 문제를 안내한다.
    if (error instanceof ProfileInputError) throw error;
    throw new ProfileInputError("이미지가 손상됐거나 디코딩 크기 제한을 초과했습니다.");
  }
  // 모든 변환 단계가 저장 상한을 초과하면 기존 프로필을 유지한다.
  throw new ProfileInputError("이미지를 저장 용량에 맞게 줄일 수 없습니다.");
}

/**
 * 삭제 실패를 기록하고 정리 명령이 나중에 다시 처리할 수 있게 한다.
 * @param storage 프로필 저장소.
 * @param key 이미 참조가 제거된 객체.
 */
async function removeOrLeaveForCleanup(storage: ProfileStorage, key: string) {
  try {
    // 연결이 제거된 객체는 가능한 경우 즉시 삭제한다.
    await storage.remove(key);
  } catch (error) {
    // 참조에는 영향이 없으므로 저장 결과는 유지하고 오류 종류만 남긴다.
    console.warn("[프로필 이미지 정리]", error instanceof Error ? error.name : "UnknownError");
  }
}

/**
 * 이미지가 있으면 먼저 업로드한 후 검증 시 읽은 경로를 조건으로 프로필을 교체한다.
 * @param repository 사용자 기본 키로 프로필을 저장하는 저장소.
 * @param openStorage 이미지가 있는 경우에만 호출할 객체 저장소 생성 함수.
 * @param input 검증된 소유자, 기존 이미지 경로, 새 닉네임과 선택 파일.
 * @returns 저장 성공 여부. 다른 요청이 이미 이미지를 바꾸었으면 false.
 * @throws 입력 또는 저장소에서 오류가 발생한 경우.
 */
export async function saveProfile(
  repository: ProfileRepository,
  openStorage: () => ProfileStorage,
  input: { userId: string; previousImage: string | null; nickname: string; file?: Buffer },
) {
  // 공백을 제외한 닉네임의 길이를 유니코드 문자 기준으로 검증한다.
  const nickname = input.nickname.trim();
  if (!nickname || Array.from(nickname).length > 50) throw new ProfileInputError("닉네임을 1~50자로 입력해 주세요.");
  // 이름만 바꾸는 요청에서는 이미지 저장소와 기존 경로를 건드리지 않는다.
  if (!input.file) return repository.updateProfile(input.userId, nickname);

  // 파일 검증을 완료한 뒤 재사용하지 않는 객체 키를 발급한다.
  const bytes = await encodeProfileImage(input.file);
  const key = ownerPrefix(input.userId) + randomUUID() + ".webp";
  const storage = openStorage();
  // 업로드가 완료된 객체만 참조한다. 전송이 불확실하면 잔여 객체는 정리 명령에서 처리한다.
  await storage.put(key, bytes);
  // DB 결과가 불확실한 예외에서는 참조 중인 객체 삭제를 피하도록 정리 명령에 맡긴다.
  const saved = await repository.updateProfile(input.userId, nickname, { previous: input.previousImage, next: key });
  if (!saved) {
    // 조건이 맞지 않아 저장하지 않은 경우 새 객체만 정리한다.
    await removeOrLeaveForCleanup(storage, key);
    return false;
  }
  // 저장이 확정된 뒤에만 해당 사용자가 소유한 이전 업로드를 삭제한다.
  if (input.previousImage && parseProfileImageKey(input.previousImage)?.owner === input.userId) {
    await removeOrLeaveForCleanup(storage, input.previousImage);
  }
  return true;
}

import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PROFILE_IMAGE_PREFIX } from "./profile";

/**
 * 필요할 때만 비공개 R2 버킷의 서버 자격 증명을 읽고 프로필 객체 저장소를 연다.
 * @returns 이미지 업로드·읽기·삭제와 정리용 목록을 제공하는 저장소.
 * @throws R2 설정이 없거나 계정 ID 형식이 올바르지 않으면 오류를 발생시킨다.
 */
export function openProfileStorage() {
  // 프로필 기능의 버킷으로 권한 범위를 제한한 자격 증명을 사용한다.
  const { R2_ACCOUNT_ID, R2_PROFILE_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID)
      || !R2_PROFILE_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("프로필 이미지 R2 설정이 필요합니다.");
  }
  // R2 S3 API에만 서명하며 추가 체크섬은 프로토콜에서 요구할 때 사용한다.
  const client = new S3Client({
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region: "auto",
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  // 모든 명령이 같은 프로필 버킷을 사용한다.
  const bucket = R2_PROFILE_BUCKET;
  return {
    /**
     * 검증된 WebP를 전송해 DB에서 참조할 새 객체를 만든다.
     * @param key 해당 사용자의 새 객체 키.
     * @param bytes 메타데이터를 제거한 WebP.
     * @throws 저장에 실패하면 R2 오류를 전달한다.
     */
    async put(key: string, bytes: Buffer) {
      // 고유 키가 예외적으로 충돌하더라도 이미 있는 객체의 파일을 덮어쓰지 않는다.
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: bytes, ContentType: "image/webp", IfNoneMatch: "*",
      }));
    },

    /**
     * 권한 검증을 끝낸 경로의 이미지를 앱 응답에서 제공할 형태로 읽는다.
     * @param key 현재 사용자의 DB가 참조하는 객체 키.
     * @returns 파일 바이트 또는 존재하지 않는 경우 undefined.
     * @throws 파일 누락 이외의 R2 오류는 호출자에게 전달한다.
     */
    async read(key: string) {
      try {
        // 공개 URL 없이 비공개 버킷에서 객체를 가져온다.
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await result.Body?.transformToByteArray();
      } catch (error) {
        // 삭제됐거나 사라진 객체는 UI에서 대체 이미지를 표시하도록 한다.
        if (error instanceof Error && error.name === "NoSuchKey") return undefined;
        throw error;
      }
    },

    /**
     * DB에서 참조되지 않는 객체를 삭제한다.
     * @param key 서비스가 만든 프로필 객체 키.
     * @throws 삭제 실패 시 재시도가 필요하므로 오류를 전달한다.
     */
    async remove(key: string) {
      // 이미 삭제된 객체에도 같은 요청을 안전하게 사용하는 S3 삭제 의미를 따른다.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    /**
     * 정리 대상 접두사의 객체를 전체 목록이 메모리에 쌓이지 않게 페이지 단위로 조회한다.
     * @yields 키, 마지막 변경 시각 등 정리 판단에 필요한 객체 메타데이터.
     * @throws 목록 조회에 실패하면 정리 명령에 오류를 전달한다.
     */
    async *list() {
      // 첫 페이지에서는 계속 조회할 위치를 지정하지 않는다.
      let continuation: string | undefined;
      do {
        // 관리 대상 외의 객체는 조회하지 않는다.
        const result = await client.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: PROFILE_IMAGE_PREFIX, ContinuationToken: continuation,
        }));
        // 다음 페이지를 요청하기 전에 받은 객체를 정리 로직에 넘긴다.
        yield* result.Contents ?? [];
        continuation = result.NextContinuationToken;
      } while (continuation);
    },
  };
}

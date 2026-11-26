import { randomUUID } from "node:crypto";
import type { BusinessApi, BusinessItem } from "@/entities/business/model/business-apis";
import { collectionAsyncStep, collectionError, describeCollectionError } from "@/shared/api/g2b/collection-diagnostic";
import type { G2bDatabase } from "@/server/g2b/repository/database";
import { openBusinessInformation } from "@/server/g2b/repository/business-information";
import { getG2bDatabase } from "@/server/g2b/repository";
import { BUSINESS_API_TIMEOUT_MS, collectBusinessApi } from "./collect-business-api";

/** 사업자 번호와 한국 기준일을 받아 업무 유형의 전체 페이지를 수집하는 서버 함수다. */
type CollectBusinessApi = (kind: BusinessApi, number: string, referenceDate: string) => Promise<BusinessItem[]>;

/** 네트워크 수집이 끝난 뒤 DB에 반영할 시간을 확보하는 실행권 유효 기간. */
const LEASE_MS = 3 * BUSINESS_API_TIMEOUT_MS;
/** 수집 시작 시각을 한국 기준일로 변환하는 공용 포매터. */
const koreanDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

/** 재시도 요청에 등록 관계가 없을 때 서비스와 화면이 공유하는 오류다. */
export class BusinessNotRegisteredError extends Error {
  /** 사업자 존재 여부와 관계없이 일관된 접근 오류를 생성한다. */
  constructor() {
    // 등록 관계가 없는 요청에는 사업자 존재 여부를 공개하지 않는다.
    super("등록된 사업자 정보를 찾을 수 없습니다.");
  }
}

/**
 * 사용자 입력을 저장·조회에 공통으로 사용할 사업자번호로 변환한다.
 * @param input 구분자 없는 10자리 번호 또는 3-2-5 형식.
 * @returns 앞자리 0을 보존한 검증된 10자리 번호.
 * @throws 입력의 형식이나 검증 숫자가 맞지 않는 경우.
 */
export function normalizeBusinessNumber(input: string) {
  // 입력 바깥의 공백만 제거하고 유효한 두 표기법을 확인한다.
  const text = input.trim();
  if (!/^(?:\d{10}|\d{3}-\d{2}-\d{5})$/.test(text)) {
    // 임의 문자가 섞인 입력은 저장소로 전달하지 않는다.
    throw new Error("사업자등록번호 형식을 확인해 주세요.");
  }

  // 각 자리의 검증 가중치와 아홉째 자리 곱의 십의 자리를 합산한다.
  const number = text.replaceAll("-", "");
  const digits = Array.from(number, Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const sum = weights.reduce((total, weight, index) => total + weight * digits[index], Math.floor(digits[8] * 5 / 10));
  if ((10 - sum % 10) % 10 !== digits[9]) {
    // 잘못 입력한 번호로 공유 사업자나 연결이 생기는 것을 막는다.
    throw new Error("사업자등록번호의 검증 숫자를 확인해 주세요.");
  }

  // 형식과 체크섬을 모두 검증한 번호만 반환한다.
  return number;
}

/**
 * 설정한 자격 증명의 원문과 자주 사용되는 URL 인코딩 표기를 진단 원문에서 제거한다.
 * @param value 길이를 자르기 전 오류 메시지 또는 중첩 진단 필드.
 * @returns 서비스 키와 DB 인증 토큰이 마스킹된 문자열.
 */
function redactCredentials(value: string) {
  // 외부 기관의 키와 수집 상태 저장에 사용하는 DB 인증 토큰을 함께 제거한다.
  const keys = [process.env.PPS_USER_INFO_SERVICE_KEY, process.env.SMPP_CERT_INFO_SERVICE_KEY, process.env.TURSO_AUTH_TOKEN];
  let redacted = value;
  for (const configured of keys) {
    // 비어 있는 값은 일반 오류 내용과 일치하지 않게 건너뛴다.
    const key = configured?.trim();
    if (!key) continue;
    let decoded = key;
    try {
      // 포털에서 복사한 인코딩 키와 실제 전송에 사용하는 디코딩 키를 함께 제거한다.
      decoded = decodeURIComponent(key);
    } catch {
      // 잘못된 인코딩 자체가 설정 오류여도 설정 원문은 제거한다.
    }
    // encodeURIComponent와 폼 쿼리의 표기 및 소문자 퍼센트 이스케이프도 제거한다.
    const variants = [key, decoded, encodeURIComponent(decoded), new URLSearchParams({ k: decoded }).toString().slice(2)];
    for (const variant of variants) {
      // 일반 문자의 대소문자는 유지하고 퍼센트 표기만 별도로 처리한다.
      redacted = redacted.replaceAll(variant, "[인증 정보 생략]")
        .replaceAll(variant.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()), "[인증 정보 생략]");
    }
  }
  // 공통 진단 정제기가 추가로 헤더, URL 쿼리와 본문을 제거한다.
  return redacted;
}

/**
 * 인증 이후 호출하는 사업자 등록 및 재수집 서비스를 연다.
 * @param db 기존 인증 사용자와 사업자 마이그레이션을 공유하는 DB 연결.
 * @param collect 유형별 외부 호출. 기본 수집기는 서버 환경의 기관별 서비스 키를 사용한다.
 * @returns 등록 및 등록 관계를 확인하는 재시도 명령.
 */
export function openBusinessRegistration(db: G2bDatabase, collect: CollectBusinessApi = collectBusinessApi) {
  // 등록과 실행 상태를 같은 DB 연결에 기록한다.
  const store = openBusinessInformation(db);

  /**
   * 확보한 API를 서로 독립적으로 완료 처리하고, 실패 진단의 저장 오류까지 확인한다.
   * @param id 공유 사업자의 내부 ID.
   * @param number 외부 조회에 전달하는 사업자등록번호.
   * @param kinds 현재 시도에 할당된 API 목록.
   * @param token 늦게 돌아온 이전 실행의 저장을 차단하는 시도 식별자.
   * @param referenceDate 현재 SMPP 호출에 공통으로 전달할 기준일.
   * @throws API 실패 진단 자체를 DB에 기록할 수 없었던 경우.
   */
  async function run(id: number, number: string, kinds: BusinessApi[], token: string, referenceDate: string) {
    // 외부 호출은 병렬로 진행하고 한 API가 실패해도 나머지 응답을 모두 기다린다.
    const responses = await Promise.allSettled(kinds.map(async (kind) => collect(kind, number, referenceDate)));
    // 같은 사업자의 완료 결과를 순차 기록해 동시에 여러 쓰기 트랜잭션을 열지 않는다.
    let failedToRecord = false;
    for (const [index, kind] of kinds.entries()) {
      // 요청 순서에 대응하는 결과로 이 API의 상태만 갱신한다.
      const response = responses[index];
      try {
        // 수집 실패는 원래 예외의 진단을 보존하도록 실패 기록 경로로 전달한다.
        if (response.status === "rejected") throw response.reason;
        // 검증이 끝난 API는 현재 실행권으로 업무 행과 완료 상태를 저장한다.
        const result = await collectionAsyncStep("사업자 정보 저장", () => store.complete(id, kind, token, response.value));
        // 실행권 상실은 새 시도의 상태를 변경하지 않고 다음 API로 넘어간다.
        if (result === "lease-lost") continue;
      } catch (error) {
        // 업무 저장 트랜잭션은 이미 취소됐으므로 기존 데이터는 유지하고 상태만 기록한다.
        const diagnostics = describeCollectionError(error, redactCredentials);
        try {
          // 정제된 진단을 현재 실행의 실패 상태에 기록한다.
          await store.fail(id, kind, token, diagnostics);
        } catch (writeError) {
          // 기록 장애의 단계와 두 오류를 정제한 뒤 내부 식별자와 함께 서버 로그에 남긴다.
          const writeDiagnostics = describeCollectionError(
            collectionError(writeError, { step: "저장소 사업자 수집 실패 상태 기록" }), redactCredentials,
          );
          console.error("[사업자 수집 실패 및 상태 저장 실패]", id, kind, diagnostics, writeDiagnostics);
          // DB가 실패 상태를 받지 못해도 다음 API의 결과 저장을 이어 간다.
          failedToRecord = true;
        }
      }
    }

    // DB 장애 중에도 다른 API를 끝까지 처리한 뒤 정제된 고정 메시지를 호출자에게 전달한다.
    if (failedToRecord) {
      throw new Error("일부 사업자 정보의 수집 상태를 저장하지 못했습니다.");
    }
  }

  /**
   * 입력한 번호를 사용자와 연결하고 이번 요청에 할당된 API를 수집한다.
   * @param userId 인증 진입점에서 확인한 서비스 사용자 ID.
   * @param input 사용자가 직접 입력한 사업자등록번호.
   * @returns 목록과 상세에서 사용할 공유 사업자의 내부 ID.
   * @throws 번호가 유효하지 않거나 등록 관계 또는 수집 상태를 저장할 수 없는 경우.
   */
  async function register(userId: string, input: string) {
    // DB 변경 전에 번호를 검증하고 실행 세대를 정한다.
    const number = normalizeBusinessNumber(input);
    const token = randomUUID();
    // 사용자 연결과 API 실행권을 같이 커밋한 다음 외부 호출을 시작한다.
    const { id, kinds, referenceDate } = await db.transaction(async () => {
      // 공유 행을 확보하고 이 사용자와 연결한다.
      const id = await store.register(userId, number);
      // 새 실행권과 SMPP 기준일은 동일한 시점에 결정한다.
      const now = Date.now();
      const referenceDate = koreanDate.format(now).replaceAll("-", "");
      const kinds = await store.claim(id, token, now, now + LEASE_MS, referenceDate);
      // 커밋 후 수집할 대상을 정한다.
      return { id, kinds, referenceDate };
    });
    // 동시 등록이 이미 수집을 시작했다면 현재 할당 목록은 비어 있다.
    await run(id, number, kinds, token, referenceDate);
    // 신규·기존 등록 모두 같은 공유 사업자 ID로 표시한다.
    return id;
  }

  /**
   * 등록 관계가 있는 사용자에게만 실패·미완료 API 재수집을 허용한다.
   * @param userId 인증 진입점에서 확인한 서비스 사용자 ID.
   * @param id 사용자가 재수집을 요청한 사업자 내부 ID.
   * @throws 등록 관계가 없거나 수집 상태를 저장할 수 없는 경우.
   */
  async function retry(userId: string, id: number) {
    // 새 실행 세대로 이전 시도의 결과와 상태 갱신을 분리한다.
    const token = randomUUID();
    const { number, kinds, referenceDate } = await db.transaction(async () => {
      // 사용자 연결을 확인한 같은 트랜잭션에서 수집 실행권을 확보한다.
      const number = await store.registeredNumber(userId, id);
      if (!number) throw new BusinessNotRegisteredError();
      // SMPP 기준일은 이번 수집 시작 시점의 한국 날짜를 사용한다.
      const now = Date.now();
      const referenceDate = koreanDate.format(now).replaceAll("-", "");
      const kinds = await store.claim(id, token, now, now + LEASE_MS, referenceDate);
      // 승인된 사업자와 획득한 실행권만 트랜잭션 밖으로 전달한다.
      return { number, kinds, referenceDate };
    });
    // 이미 성공했거나 다른 요청에서 실행 중인 API는 호출하지 않는다.
    await run(id, number, kinds, token, referenceDate);
  }

  // 화면 및 액션에서 인증 이후 재사용할 수 있는 서버 명령을 노출한다.
  return { register, retry };
}

/**
 * 운영 앱의 공유 연결로 사업자 등록 서비스를 구성한다.
 * @returns 인증된 진입점이 호출할 등록 및 재수집 명령.
 * @throws 기존 Turso 연결 환경 변수가 설정되지 않은 경우.
 */
export function getBusinessRegistration() {
  // 새 연결을 만들지 않고 현재 프로세스의 앱 DB 연결을 사용한다.
  return openBusinessRegistration(getG2bDatabase());
}

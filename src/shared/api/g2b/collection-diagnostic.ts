type DiagnosticContext = {
  step: string;
  request?: { path: string; submissionId?: string; timeoutMs?: number };
  response?: { status: number; contentType?: string; errorCode?: string | number; errorMessage?: string };
  details?: Record<string, string | number>;
};

export type CollectionDiagnostic = Partial<DiagnosticContext> & {
  name: string;
  message?: string;
  stack?: string;
  code?: string | number;
  errno?: string | number;
  syscall?: string;
  errcode?: number;
  errstr?: string;
  cause?: CollectionDiagnostic;
  errors?: CollectionDiagnostic[];
};

// 호출자가 점검·접근 거부 예외를 같은 타입으로 처리할 수 있도록 원본 객체에 진단을 연결한다.
const contexts = new WeakMap<Error, DiagnosticContext>();

/**
 * 예외의 타입과 스택을 보존하면서 실패 지점과 확인된 근거를 연결한다.
 * @returns 원본 예외. Error가 아닌 값은 원인으로 연결한 예외를 반환한다.
 */
export function collectionError(reason: unknown, context: DiagnosticContext): Error {
  const error = reason instanceof Error ? reason : new Error("수집 작업이 실패했습니다.", { cause: reason });
  contexts.set(error, { ...contexts.get(error), ...context });
  return error;
}

/**
 * 동기 작업에 실패하면 진단에 사용할 단계명을 붙여 다시 던진다.
 * @throws 저장소 접근 또는 응답 검증 작업에서 발생한 예외.
 */
export function collectionStep<T>(step: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw collectionError(error, { step });
  }
}

/**
 * 비동기 저장소 호출의 거부에 진단 단계명을 연결한다.
 * @throws 저장소 호출 또는 입력 검증이 실패한 경우 원래 예외를 전달한다.
 */
export async function collectionAsyncStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw collectionError(error, { step });
  }
}

function cleanText(value: string, limit = 500, frame = false): string {
  // 본문이 포함된 메시지는 본문 경계부터 제거하고 키·헤더로 드러난 자격 증명은 마스킹한다.
  const text = frame ? value : value.replace(/(?:\b(?:response|request)?\s*body\s*[:=]|[<{])[\s\S]*$/i, "[본문 생략]");
  return text
    .replace(/\b(?:set-cookie|cookie|authorization)\s*[:=][^\r\n]*/gi, "[인증 정보 생략]")
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, "[인증 정보 생략]")
    .replace(/\b(?:session(?:id)?|jsessionid|[\w-]*(?:token|password|secret|(?:api|service)[_-]?key|credential)[\w-]*)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, "[인증 정보 생략]")
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[인증 정보 생략]@")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]+/gi, "$1")
    .slice(0, limit);
}

function scalar(value: unknown): string | number | undefined {
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
}

/**
 * 중첩 예외를 SQLite와 관리자 화면에서 사용할 JSON 데이터로 변환한다.
 * @param reason 수집 실패에서 전달된 원본 예외 또는 병렬 실패 묶음.
 * @param redact 알려진 인증 값을 문자열 길이 제한과 로그 정제 전에 제거하는 선택 함수.
 * @returns 각 예외의 호출 위치와 확인된 근거. 순환 참조나 크기 한도에 닿으면 그 지점을 표시한다.
 */
export function describeCollectionError(reason: unknown, redact?: (value: string) => string): CollectionDiagnostic {
  /**
   * 기존 진단 정제 전에 호출자가 제공한 자격 증명 제거를 적용한다.
   * @param text 오류 또는 허용된 진단 필드 원문.
   * @param limit 저장할 문자열 길이 상한.
   * @param frame 실제 호출 프레임인지 여부.
   * @returns 마스킹과 길이 제한을 적용한 문자열.
   */
  function clean(text: string, limit?: number, frame?: boolean) {
    // 길이 제한으로 키 일부가 남는 것을 막기 위해 원문에서 먼저 제거한다.
    return cleanText(redact ? redact(text) : text, limit, frame);
  }

  /**
   * 예외의 코드나 추가 진단 필드에서 안전한 스칼라만 추출한다.
   * @param value 예외 또는 응답에서 추출한 값.
   * @returns 정제된 문자열, 유한한 숫자 또는 undefined.
   */
  function cleanScalar(value: unknown) {
    // 문자열은 원문에서 자격 증명을 제거하고 숫자는 기존 공통 검증을 사용한다.
    return typeof value === "string" ? clean(value) : scalar(value);
  }

  const ancestors = new Set<Error>();
  let remaining = 100;

  function visit(value: unknown, depth: number): CollectionDiagnostic {
    if (!(value instanceof Error)) return { name: "Error", message: "예외 객체에서 원인을 확인할 수 없습니다." };
    if (ancestors.has(value)) return { name: "Error", message: "원인에 순환 참조가 있습니다." };
    if (depth >= 12 || remaining-- <= 0) return { name: "Error", message: "진단 저장 한도에 도달했습니다." };

    ancestors.add(value);
    const context = contexts.get(value);
    const fields = value as Error & Record<string, unknown>;
    // 예외 제목과 메시지에 동일한 자격 증명 제거 절차를 적용한다.
    const name = clean(value.name, 100);
    const message = value instanceof SyntaxError ? "JSON 해석에 실패했습니다." : clean(value.message);
    const stack = typeof value.stack === "string" ? value.stack : undefined;
    const title = `${value.name}: ${value.message}`;
    // 예외 메시지에 호출 프레임처럼 생긴 문자열이 있어도 실제 스택 프레임만 저장한다.
    const frameText = stack?.startsWith(title) ? stack.slice(title.length) : stack?.split("\n").slice(1).join("\n");
    const frames = frameText?.split(/\r?\n/).filter((line) => /^\s+at /.test(line) && /:\d+:\d+\)?$/.test(line));
    const diagnostic: CollectionDiagnostic = {
      ...context,
      name,
      message,
      // 메시지가 여러 줄이어도 원문 대신 정리한 제목과 호출 프레임만 사용한다.
      stack: stack ? [`${name}: ${message}`, ...(frames ?? []).map((line) => clean(line, 500, true))].join("\n").slice(0, 4000) : undefined,
      code: cleanScalar(fields.code),
      errno: cleanScalar(fields.errno),
      syscall: typeof fields.syscall === "string" ? clean(fields.syscall) : undefined,
      errcode: typeof fields.errcode === "number" ? fields.errcode :
        typeof fields.rawCode === "number" ? fields.rawCode : undefined,
      errstr: typeof fields.errstr === "string" ? clean(fields.errstr) :
        typeof fields.extendedCode === "string" ? clean(fields.extendedCode) : undefined,
      cause: value.cause === undefined ? undefined : visit(value.cause, depth + 1),
      errors: value instanceof AggregateError ? value.errors.slice(0, Math.max(remaining, 1)).map((error) => visit(error, depth + 1)) : undefined,
    };
    // 알려진 서버 자격 증명을 받는 진단에서는 요청 정보도 저장하기 전에 정제한다.
    if (redact && context?.request) {
      // 쿼리는 상대 경로 형식에서도 통째로 제외하고 내부 추적 키는 별도로 정제한다.
      diagnostic.request = {
        path: clean(context.request.path.split(/[?#]/, 1)[0]),
        submissionId: context.request.submissionId && clean(context.request.submissionId),
        timeoutMs: context.request.timeoutMs,
      };
    }
    if (context?.response) {
      const { status, contentType, errorCode, errorMessage } = context.response;
      diagnostic.response = {
        status,
        contentType: contentType && clean(contentType),
        errorCode: cleanScalar(errorCode),
        errorMessage: errorMessage && clean(errorMessage),
      };
    }
    if (context?.details) {
      // 호출자가 준 비밀 값이 진단 항목명이나 값에 들어 있어도 그대로 저장하지 않는다.
      diagnostic.details = Object.fromEntries(Object.entries(context.details).map(([key, detail]) => [
        redact ? redact(key) : key, cleanScalar(detail) ?? "확인 불가",
      ]));
    }
    ancestors.delete(value);
    return diagnostic;
  }

  return visit(reason, 0);
}

/**
 * 응답 검증 실패에 필드 경로와 비교에 사용한 식별자를 기록한다.
 * @returns 원래 업무 오류 문구와 비교 근거를 가진 예외.
 */
export function collectionValidationError(
  message: string,
  field: string,
  expected?: { number: string; revision?: string },
  actual?: { number: unknown; revision?: unknown },
): Error {
  const details: Record<string, string | number> = { "응답 필드": field };
  if (expected) details["기대한 번호"] = expected.number;
  if (expected?.revision !== undefined) details["기대한 차수"] = expected.revision;
  if (actual) {
    details["응답 번호"] = scalar(actual.number) ?? "없음";
    if (expected?.revision !== undefined) details["응답 차수"] = scalar(actual.revision) ?? "없음";
  }
  return collectionError(new Error(message), { step: "응답 검증", details });
}

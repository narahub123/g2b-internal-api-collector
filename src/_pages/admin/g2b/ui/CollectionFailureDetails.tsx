import type { CollectionDiagnostic } from "@/shared/api/g2b/collection-diagnostic";

/**
 * 최신 수집 이력의 진단을 관리자 목록에서 펼쳐 본다.
 * 과거 이력 또는 읽을 수 없는 진단은 목록의 기존 요약을 사용한다.
 */
export function CollectionFailureDetails({ diagnostics }: { diagnostics: string }) {
  let error: CollectionDiagnostic;
  try {
    error = JSON.parse(diagnostics);
  } catch {
    return null;
  }
  if (!error?.name) return null;

  return (
    <details className="mt-2 min-w-0">
      <summary className="cursor-pointer font-medium">원인 보기</summary>
      <DiagnosticError error={error} />
    </details>
  );
}

/** 각 조회의 실패 근거를 표시하고 중첩 원인과 호출 스택을 해당 예외 아래에 배치한다. */
function DiagnosticError({ error }: { error: CollectionDiagnostic }) {
  const { step, request, response, details, code, errno, syscall, errcode, errstr } = error;
  const fields = {
    "요청 경로": request?.path,
    submissionid: request?.submissionId,
    "제한 시간": request?.timeoutMs === undefined ? undefined : `${request.timeoutMs}ms`,
    "HTTP 상태": response?.status,
    "응답 유형": response?.contentType,
    "나라장터 오류 코드": response?.errorCode,
    "나라장터 오류 설명": response?.errorMessage,
    "오류 코드": code,
    errno,
    syscall,
    "SQLite 확장 코드": errcode,
    "SQLite 오류 설명": errstr,
    ...details,
  };
  return (
    <div className="mt-2 min-w-0 space-y-1 border-l pl-3 wrap-anywhere">
      <p><strong>{step ?? error.name}</strong>{error.message && ` · ${error.message}`}</p>
      <dl className="text-muted-foreground">
        {Object.entries(fields).map(([label, value]) => value !== undefined && (
          <div key={label} className="flex flex-wrap gap-x-2">
            <dt className="font-medium">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {response?.status === 503 && !response.errorMessage && <p>나라장터 서버 내부 원인 확인 불가</p>}
      {error.stack && (
        <details>
          <summary className="cursor-pointer">스택 보기</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{error.stack}</pre>
        </details>
      )}
      {error.cause && <DiagnosticError error={error.cause} />}
      {error.errors?.map((child, index) => <DiagnosticError key={index} error={child} />)}
    </div>
  );
}

type G2bWorkflow = "notice-collection.yml" | "attachment-processing.yml";

// Vercel은 워크플로 실행 접수 응답까지만 기다리며 공고 수집과 첨부 처리에 같은 제한을 적용한다.
const WORKFLOW_DISPATCH_TIMEOUT_MS = 8_000;

/**
 * 배포 서버에 설정한 저장소·브랜치에서 지정한 워크플로 실행을 요청한다.
 * @throws 설정 누락, 통신 실패, 8초 제한 초과 또는 GitHub의 요청 거절을 전달한다.
 */
export async function dispatchG2bWorkflow(workflow: G2bWorkflow) {
  const repository = process.env.NOTICE_GITHUB_REPOSITORY?.trim();
  const ref = process.env.NOTICE_GITHUB_REF?.trim();
  const credential = process.env.NOTICE_GITHUB_TOKEN?.trim();
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !ref || !credential) {
    throw new Error("GitHub Actions 배포 설정을 확인해 주세요.");
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: JSON.stringify({ ref }),
    signal: AbortSignal.timeout(WORKFLOW_DISPATCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${workflow} 호출 실패 (HTTP ${response.status})`);
}

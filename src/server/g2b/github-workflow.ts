type G2bWorkflow = "notice-collection.yml" | "attachment-processing.yml";
type WorkflowTarget = { repository?: string; ref?: string; credential?: string };

// Vercel은 워크플로 실행 접수 응답까지만 기다리며 공고 수집과 첨부 처리에 같은 제한을 적용한다.
const WORKFLOW_DISPATCH_TIMEOUT_MS = 8_000;

/**
 * 지정한 워크플로를 호출한다. 웹 서버는 배포 설정을, Actions 워커는 실행 토큰을 전달한다.
 * @throws 설정 누락, 통신 실패, 8초 제한 초과 또는 GitHub의 요청 거절을 전달한다.
 */
export async function dispatchG2bWorkflow(workflow: G2bWorkflow, target: WorkflowTarget = {
  repository: process.env.NOTICE_GITHUB_REPOSITORY,
  ref: process.env.NOTICE_GITHUB_REF,
  credential: process.env.NOTICE_GITHUB_TOKEN,
}, inputs?: Record<string, string | boolean>) {
  const repository = target.repository?.trim();
  const ref = target.ref?.trim();
  const credential = target.credential?.trim();
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
    body: JSON.stringify({ ref, inputs }),
    signal: AbortSignal.timeout(WORKFLOW_DISPATCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${workflow} 호출 실패 (HTTP ${response.status})`);
}

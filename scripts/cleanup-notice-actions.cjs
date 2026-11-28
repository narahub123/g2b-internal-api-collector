// 공고, 첨부와 사전의 성공 기록에 같은 보존 기간을 적용한다.
const retentionMs = 24 * 60 * 60_000;
const workflowPaths = [
  '/actions/workflows/notice-collection.yml/runs',
  '/actions/workflows/attachment-processing.yml/runs',
  '/actions/workflows/dictionary-collection.yml/runs',
];

function expiredSuccess(run, cutoff) {
  return run?.status === 'completed' && run.conclusion === 'success' && Date.parse(run.updated_at) <= cutoff;
}

/**
 * 허용된 큐 워크플로 하나에서 24시간이 지난 성공 실행을 정리한다.
 * 이전 시도가 실패했거나 삭제 직전 실행 상태가 바뀌었으면 보존한다.
 * @param request 저장소 범위의 GitHub 요청 함수. 목록 요청은 페이지와 다음 페이지 여부를 반환한다.
 * @param workflowRuns 공고 또는 첨부 워크플로의 실행 목록 경로.
 * @returns 삭제한 실행 ID. 미리보기에서는 삭제 대상 ID.
 * @throws GitHub 조회나 삭제가 실패하여 정리 결과를 확정하지 못한 경우.
 */
async function cleanupWorkflowRuns(request, workflowRuns, now, dryRun) {
  const cutoff = now - retentionMs;
  const created = encodeURIComponent(`<=${new Date(cutoff).toISOString()}`);
  const candidates = new Set();
  // 삭제로 페이지 위치가 바뀌지 않도록 후보를 모두 확인한 후 삭제한다.
  for (let page = 1; ; page++) {
    const { runs, next } = await request(`${workflowRuns}?page=${page}&per_page=100&status=success&created=${created}`);
    for (const run of runs) {
      if (expiredSuccess(run, cutoff)) candidates.add(run.id);
    }
    if (!next) break;
  }

  const selected = [];
  for (const id of candidates) {
    const path = `/actions/runs/${id}`;
    const run = await request(path);
    if (!expiredSuccess(run, cutoff)) continue;
    let allSucceeded = true;
    for (let attempt = 1; attempt < run.run_attempt; attempt++) {
      const previous = await request(`${path}/attempts/${attempt}`);
      if (previous?.conclusion !== 'success') {
        allSucceeded = false;
        break;
      }
    }
    if (!allSucceeded) continue;
    if (!dryRun || run.run_attempt > 1) {
      const current = await request(path);
      if (!expiredSuccess(current, cutoff) || current.run_attempt !== run.run_attempt) continue;
    }
    if (!dryRun) await request(path, 'DELETE');
    selected.push(id);
  }
  return selected;
}

/** 각 워크플로를 독립적으로 정리하고 한쪽 오류는 나머지를 처리한 후 보고한다. */
async function cleanupQueueRuns(request, now, dryRun, report = console.log) {
  const errors = [];
  for (const path of workflowPaths) {
    try {
      const runs = await cleanupWorkflowRuns(request, path, now, dryRun);
      report(`${path} · ${dryRun ? '삭제 대상' : '삭제 완료'} ${runs.length}건 · ${runs.join(', ')}`);
    } catch (error) {
      errors.push(`${path} · ${error.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

async function main() {
  const { GITHUB_REPOSITORY, GH_TOKEN, NOTICE_CLEANUP_DRY_RUN } = process.env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY ?? '') || !GH_TOKEN) {
    throw new Error('GitHub 저장소와 정리 작업 토큰을 확인해 주세요.');
  }
  const dryRun = NOTICE_CLEANUP_DRY_RUN !== 'false';
  async function request(path, method = 'GET') {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GH_TOKEN}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    const isList = workflowPaths.some((workflow) => path.startsWith(`${workflow}?`));
    if (response.status === 404 && !isList) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path} 실패 (HTTP ${response.status})`);
    if (method === 'DELETE') return;
    const body = await response.json();
    if (isList) {
      return { runs: body.workflow_runs, next: /rel="next"/.test(response.headers.get('Link') ?? '') };
    }
    return body;
  }

  await cleanupQueueRuns(request, Date.now(), dryRun);
}

module.exports = { cleanupQueueRuns };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

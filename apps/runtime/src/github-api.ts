import { createLogger } from './logger.js';

const log = createLogger('github-api');

const REPO = 'bearjun05/rego-agent';
const API = 'https://api.github.com';

/**
 * 학습자 브랜치(learner/<name>)를 main 기준으로 자동 생성 (T6).
 *
 * 이미 존재하면 created=false (no-op).
 * 토큰 없거나 권한 부족하면 created=false + sha=null (학습자가 수동으로 만들도록 안내).
 *
 * @param token GitHub PAT (repo write 권한)
 */
export async function ensureLearnerBranch(
  agentName: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ created: boolean; sha: string | null; error?: string }> {
  const branch = `learner/${agentName}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rego-agent',
  };

  // 1. 이미 있나?
  try {
    const check = await fetchImpl(`${API}/repos/${REPO}/git/ref/heads/${branch}`, { headers });
    if (check.ok) {
      const data = (await check.json()) as { object: { sha: string } };
      return { created: false, sha: data.object.sha };
    }
  } catch (err) {
    log.warn(`branch check failed for ${branch}`, err);
  }

  // 2. main의 sha
  let mainSha: string;
  try {
    const main = await fetchImpl(`${API}/repos/${REPO}/git/ref/heads/main`, { headers });
    if (!main.ok) {
      return { created: false, sha: null, error: `main ref fetch failed: ${main.status}` };
    }
    mainSha = ((await main.json()) as { object: { sha: string } }).object.sha;
  } catch (err) {
    return { created: false, sha: null, error: `main ref error: ${(err as Error).message}` };
  }

  // 3. 브랜치 생성
  try {
    const create = await fetchImpl(`${API}/repos/${REPO}/git/refs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
    });
    if (!create.ok) {
      const body = await create.text().catch(() => '');
      return { created: false, sha: null, error: `create branch failed: ${create.status} ${body.slice(0, 200)}` };
    }
    log.info(`created branch ${branch} @ ${mainSha.slice(0, 8)}`);
    return { created: true, sha: mainSha };
  } catch (err) {
    return { created: false, sha: null, error: `create error: ${(err as Error).message}` };
  }
}

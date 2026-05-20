import { Hono } from 'hono';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { env } from '../env.js';
import { createLogger } from '../logger.js';
import { reloadAll, getAgentsRoot, getAgent } from '../agent-registry.js';
import { getEventBus } from '../event-bus.js';
import { syncManifestToolsForAgent, ensureAgentRow } from '../manifest-sync.js';
import { listAgents } from '../agent-registry.js';
import { analyzeAgent } from '../analyzer.js';

const log = createLogger('webhook:github');
const execAsync = promisify(exec);

const REPO_ROOT = path.resolve(getAgentsRoot(), '..');

/**
 * 서버 코드를 push와 동기화.
 * agents/ 폴더만 원격 최신으로 덮어씀 (운영자가 서버에서 작업 중인
 * 다른 파일 — 대시보드 등 — 은 건드리지 않기 위해).
 * 반환: 변경된 에이전트 slug 집합 + 현재 commit sha
 */
async function syncAgentsFromGit(): Promise<{ changed: Set<string>; commit: string }> {
  const changed = new Set<string>();
  try {
    await execAsync('git fetch origin main', { cwd: REPO_ROOT });
    const { stdout: before } = await execAsync('git rev-parse HEAD', { cwd: REPO_ROOT });
    // agents/ 폴더만 원격 버전으로 체크아웃 (working tree의 다른 변경 보존)
    const { stdout: diff } = await execAsync(
      'git diff --name-only HEAD origin/main -- agents/',
      { cwd: REPO_ROOT },
    );
    await execAsync('git checkout origin/main -- agents/', { cwd: REPO_ROOT });
    const { stdout: after } = await execAsync('git rev-parse origin/main', { cwd: REPO_ROOT });

    for (const line of diff.split('\n')) {
      const m = line.match(/^agents\/([^/]+)\//);
      if (m && m[1] && !m[1].startsWith('_')) changed.add(m[1]);
    }
    log.info(`git sync: ${changed.size} agents changed`, { changed: [...changed] });
    return { changed, commit: after.trim() || before.trim() };
  } catch (err) {
    log.error('git sync failed', err);
    return { changed, commit: 'unknown' };
  }
}

async function verifyGitHubSignature(secret: string, signature: string, body: string) {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const computed = `sha256=${Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
  // constant-time compare
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export function createGithubRouter() {
  const router = new Hono();

  router.post('/', async (c) => {
    const cfg = env();
    const raw = await c.req.text();
    const sig = c.req.header('x-hub-signature-256') ?? '';
    const eventType = c.req.header('x-github-event') ?? '';

    if (cfg.GITHUB_WEBHOOK_SECRET) {
      const valid = await verifyGitHubSignature(cfg.GITHUB_WEBHOOK_SECRET, sig, raw);
      if (!valid) {
        log.warn('invalid signature');
        return c.json({ error: 'invalid signature' }, 401);
      }
    }

    let payload: { ref?: string; commits?: Array<{ id: string; message: string; modified: string[]; added: string[]; removed: string[]; author?: { name?: string; email?: string } }> };
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }

    if (eventType === 'push') {
      log.info(`push to ${payload.ref}, ${payload.commits?.length} commits`);

      await getEventBus().publish({
        type: 'github.push',
        payload: {
          ref: payload.ref,
          commits: payload.commits?.length ?? 0,
        },
      });

      // 1) git에서 agents/ 동기화 → 2) reload → 3) DB sync → 4) 변경분 AI 분석
      queueMicrotask(async () => {
        try {
          const { changed, commit } = await syncAgentsFromGit();
          await reloadAll();
          for (const a of listAgents()) {
            await ensureAgentRow(a); // 폴더 → DB row 동기화
            await syncManifestToolsForAgent(a);
          }
          // 변경된 에이전트만 AI 분석 (코드 읽고 "뭘 만들었는지" → 대시보드 프로필)
          for (const slug of changed) {
            const agent = getAgent(slug);
            if (agent) await analyzeAgent(agent, commit);
          }
        } catch (err) {
          log.error('reload/analyze failed', err);
        }
      });
    }

    return c.json({ ok: true });
  });

  return router;
}

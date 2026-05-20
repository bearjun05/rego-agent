import { Hono } from 'hono';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, agents } from '@rego/db';
import { TelegramClient } from '@rego/tools/telegram';
import { env } from '../env.js';
import { createLogger } from '../logger.js';
import { reloadAll, getAgentsRoot, getAgent } from '../agent-registry.js';
import { refreshSlackUserMap } from '../agent-runner.js';
import { getEventBus } from '../event-bus.js';
import { syncManifestToolsForAgent, ensureAgentRow } from '../manifest-sync.js';
import { listAgents } from '../agent-registry.js';
import { analyzeAgent } from '../analyzer.js';
import { audit } from '../audit.js';

const log = createLogger('webhook:github');
const execAsync = promisify(exec);

const REPO_ROOT = path.resolve(getAgentsRoot(), '..');

type PushCommit = {
  id: string;
  message: string;
  modified: string[];
  added: string[];
  removed: string[];
  author?: { name?: string; email?: string };
};

/** 이메일 앞부분의 . → _ → 폴더 slug 추정 (uj.choe@… → uj_choe) */
function deriveSlug(email?: string): string | null {
  const local = email?.split('@')[0];
  return local ? local.replace(/\./g, '_').toLowerCase() : null;
}

interface FolderViolation {
  commit: string;
  warnSlugs: string[]; // 경고 보낼 대상(들)
  badFiles: string[]; // 본인 폴더 밖 파일
}

/**
 * 폴더 경계 검증: 한 커밋은 "에이전트 폴더 하나" 안에서만 수정해야 한다.
 * - 공통 코드(agents/ 밖) 수정 → 위반
 * - 두 개 이상의 에이전트 폴더를 동시에 수정 → 위반(남의 폴더 의심)
 * push는 이미 일어났으므로 막을 순 없지만, 본인에게 텔레그램 경고 + audit.
 * (공통 코드/남의 폴더 변경은 어차피 syncAgentsFromGit이 본인 폴더만 반영하지 않음)
 */
function validatePushFolders(commits: PushCommit[]): FolderViolation[] {
  const out: FolderViolation[] = [];
  for (const cm of commits ?? []) {
    const files = [...(cm.added ?? []), ...(cm.modified ?? []), ...(cm.removed ?? [])];
    const folders = new Set<string>();
    const common: string[] = [];
    for (const f of files) {
      const m = f.match(/^agents\/([^/]+)\//);
      if (m && m[1] && !m[1].startsWith('_')) folders.add(m[1]);
      else common.push(f);
    }
    const violated = common.length > 0 || folders.size > 1;
    if (!violated) continue;

    const authorSlug = deriveSlug(cm.author?.email);
    const warnSlugs = folders.size ? [...folders] : authorSlug ? [authorSlug] : [];
    const badFiles = folders.size > 1 ? files : common; // 다중 폴더면 전체, 아니면 공통 파일
    out.push({ commit: cm.id, warnSlugs, badFiles });
  }
  return out;
}

async function warnOutOfFolder(violations: FolderViolation[]) {
  if (!violations.length) return;
  const cfg = env();
  const db = getDb();
  const tg = cfg.TELEGRAM_BOT_TOKEN ? new TelegramClient(cfg.TELEGRAM_BOT_TOKEN) : null;

  for (const v of violations) {
    await audit({
      action: 'push.folder_violation',
      actor: v.warnSlugs[0] ?? 'unknown',
      agentName: v.warnSlugs[0],
      severity: 'warn',
      details: { commit: v.commit, badFiles: v.badFiles },
    });
    if (!tg) continue;
    const fileList = v.badFiles.slice(0, 8).map((f) => `• ${f}`).join('\n');
    for (const slug of v.warnSlugs) {
      const [row] = await db.select().from(agents).where(eq(agents.name, slug));
      if (!row?.telegramChatId) continue;
      const text =
        `⚠️ *폴더 규칙 위반*\n\n` +
        `방금 push에서 본인 폴더(\`agents/${slug}/\`) 밖이 수정됐어요.\n` +
        `규칙: **본인 폴더 안에서만** 작업해주세요 (\`git add agents/${slug}\`).\n\n` +
        `문제 파일:\n${fileList}\n\n` +
        `_공통 코드/다른 폴더 변경은 서버에 반영되지 않아요._`;
      try {
        await tg.sendMessage({ chat_id: row.telegramChatId, text, parse_mode: 'Markdown' });
      } catch (err) {
        log.error('failed to send folder-violation warning', err);
      }
    }
  }
}

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

      // 0) 폴더 경계 검증 (본인 폴더 밖 수정 시 텔레그램 경고 + audit)
      // 1) git에서 agents/ 동기화 → 2) reload → 3) DB sync → 4) 변경분 AI 분석
      queueMicrotask(async () => {
        try {
          await warnOutOfFolder(validatePushFolders(payload.commits ?? []));
        } catch (err) {
          log.error('folder validation failed', err);
        }
        try {
          const { changed, commit } = await syncAgentsFromGit();
          await reloadAll();
          for (const a of listAgents()) {
            await ensureAgentRow(a); // 폴더 → DB row 동기화
            await syncManifestToolsForAgent(a);
          }
          await refreshSlackUserMap(); // slack_user_id 매핑 갱신
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

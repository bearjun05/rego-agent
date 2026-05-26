import { Hono } from 'hono';
import { sql, desc, eq, and, gte } from 'drizzle-orm';
import {
  getDb,
  agents,
  runs,
  llmCalls,
  toolCalls,
  slackMentions,
  telegramMessages,
  smokeRuns,
  auditLogs,
  slackUserTokens,
} from '@rego/db';
import { listAgents, getAgent, reloadAgent } from '../agent-registry.js';
import { audit } from '../audit.js';
import { analyzeAgent } from '../analyzer.js';
import { fetchLearnerFolder, isSafeAgentName, agentFolderExists } from '../git-sync.js';
import { bindCronTriggers } from '../agent-cron-bind.js';
import { refreshSlackUserMap } from '../agent-runner.js';
import { syncManifestToolsForAgent, ensureAgentRow } from '../manifest-sync.js';
import { getCronScheduler } from '../cron-scheduler.js';
import { createLogger } from '../logger.js';

const reloadLog = createLogger('api:reload');
const inFlightReloads = new Map<string, Promise<unknown>>();

export function createAgentsApi() {
  const r = new Hono();

  // GET /api/agents — 전체 목록 + 요약
  r.get('/', async (c) => {
    const db = getDb();
    const rows = await db.select().from(agents).orderBy(desc(agents.createdAt));

    // 각 사람의 오늘 비용/멘션 카운트
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const summaries = await Promise.all(
      rows.map(async (a) => {
        const [costRow] = await db
          .select({
            cost: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)::text`,
            llmCount: sql<string>`COUNT(*)::text`,
          })
          .from(llmCalls)
          .where(and(eq(llmCalls.agentName, a.name), gte(llmCalls.createdAt, today)));
        const [runRow] = await db
          .select({ runs: sql<string>`COUNT(*)::text` })
          .from(runs)
          .where(and(eq(runs.agentName, a.name), gte(runs.startedAt, today)));
        const loaded = getAgent(a.name);
        return {
          name: a.name,
          displayName: a.displayName,
          githubHandle: a.githubHandle,
          telegramChatId: a.telegramChatId ? '연결됨' : null,
          icon: a.icon,
          color: a.color,
          description: a.description,
          isPaused: a.isPaused,
          pausedReason: a.pausedReason,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          loaded: !!loaded,
          manifest: loaded?.manifest ?? a.currentManifest,
          analysisSummary: a.analysisSummary,
          capabilities: a.capabilities,
          techniques: a.techniques,
          analyzedAt: a.analyzedAt,
          stats: {
            today: {
              cost: parseFloat(costRow?.cost ?? '0'),
              llmCalls: parseInt(costRow?.llmCount ?? '0', 10),
              runs: parseInt(runRow?.runs ?? '0', 10),
            },
          },
        };
      }),
    );

    return c.json({ agents: summaries });
  });

  // GET /api/agents/:name — 상세
  r.get('/:name', async (c) => {
    const name = c.req.param('name');
    const db = getDb();
    const [row] = await db.select().from(agents).where(eq(agents.name, name));
    if (!row) return c.json({ error: 'not found' }, 404);
    const loaded = getAgent(name);

    // 최근 20개 run
    const recentRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.agentName, name))
      .orderBy(desc(runs.startedAt))
      .limit(20);

    // 누적 비용
    const [costRow] = await db
      .select({ cost: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)::text` })
      .from(llmCalls)
      .where(eq(llmCalls.agentName, name));

    // Tier2 Slack 연결 여부 (비공개 채널 폴링 옵트인 상태)
    const [tokenRow] = await db
      .select({ id: slackUserTokens.id })
      .from(slackUserTokens)
      .where(and(eq(slackUserTokens.agentName, name), eq(slackUserTokens.revoked, false)));

    // Tier2 옵트인 OAuth 시작 URL (runtime 공개 URL 기준). 미설정 시 null.
    const slackOAuthUrl =
      process.env.SLACK_CLIENT_ID && process.env.SLACK_OAUTH_REDIRECT
        ? `${process.env.PUBLIC_BASE_URL ?? ''}/oauth/slack?agent=${encodeURIComponent(name)}`
        : null;

    return c.json({
      agent: {
        ...row,
        loaded: !!loaded,
        manifest: loaded?.manifest ?? row.currentManifest,
        slackConnected: !!tokenRow,
        slackOAuthUrl,
      },
      recentRuns,
      totalCostUsd: parseFloat(costRow?.cost ?? '0'),
    });
  });

  // POST /api/agents/:name/analyze — AI 코드 분석 수동 트리거 (테스트/재분석용)
  r.post('/:name/analyze', async (c) => {
    const name = c.req.param('name');
    const agent = getAgent(name);
    if (!agent) return c.json({ error: `agent ${name} not loaded` }, 404);
    await analyzeAgent(agent, 'manual');
    const db = getDb();
    const [row] = await db.select().from(agents).where(eq(agents.name, name));
    return c.json({
      ok: true,
      analysis: {
        summary: row?.analysisSummary,
        capabilities: row?.capabilities,
        techniques: row?.techniques,
      },
    });
  });

  // POST /api/agents/:name/pause — 관리자 일시정지
  r.post('/:name/pause', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason ?? 'admin paused';
    const db = getDb();
    await db
      .update(agents)
      .set({ isPaused: true, pausedReason: reason, updatedAt: new Date() })
      .where(eq(agents.name, name));
    await audit({
      action: 'agent.paused',
      actor: 'admin',
      agentName: name,
      severity: 'warn',
      details: { reason },
    });
    return c.json({ ok: true });
  });

  // POST /api/agents/:name/resume
  r.post('/:name/resume', async (c) => {
    const name = c.req.param('name');
    const db = getDb();
    await db
      .update(agents)
      .set({ isPaused: false, pausedReason: null, updatedAt: new Date() })
      .where(eq(agents.name, name));
    await audit({
      action: 'agent.resumed',
      actor: 'admin',
      agentName: name,
      severity: 'info',
    });
    return c.json({ ok: true });
  });

  // GET /api/agents/:name/mention-flow — 1주차 핵심 뷰 데이터
  // 슬랙 멘션 → 텔레그램 메시지 매핑
  r.get('/:name/mention-flow', async (c) => {
    const name = c.req.param('name');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const db = getDb();

    const messages = await db
      .select()
      .from(telegramMessages)
      .where(eq(telegramMessages.agentName, name))
      .orderBy(desc(telegramMessages.sentAt))
      .limit(limit);

    // 각 메시지에 대응하는 mention 조회
    const mentionIds = messages
      .map((m) => m.triggeredBySlackMentionId)
      .filter((v): v is number => v !== null);

    let mentionMap: Map<number, typeof slackMentions.$inferSelect> = new Map();
    if (mentionIds.length > 0) {
      const mentions = await db
        .select()
        .from(slackMentions)
        .where(sql`${slackMentions.id} IN (${sql.join(mentionIds.map((id) => sql`${id}`), sql`, `)})`);
      mentionMap = new Map(mentions.map((m) => [m.id, m]));
    }

    return c.json({
      flow: messages.map((m) => ({
        telegram: m,
        slack: m.triggeredBySlackMentionId ? mentionMap.get(m.triggeredBySlackMentionId) : null,
      })),
    });
  });

  /**
   * T5 Hot reload — 학습자가 본인 브랜치(learner/<name>) push 후
   * "내 코드 적용하기" 클릭. 5초 안에 그 학습자 폴더만 새 버전으로 교체.
   */
  r.post('/:name/reload', async (c) => {
    const name = c.req.param('name');
    if (!isSafeAgentName(name)) {
      return c.json({ ok: false, error: 'invalid agent name' }, 400);
    }
    if (inFlightReloads.has(name)) {
      return c.json({ ok: false, error: 'reload already in progress' }, 429);
    }
    const task = doHotReload(name);
    inFlightReloads.set(name, task);
    try {
      const result = await task;
      return c.json(result, result.ok ? 200 : 500);
    } finally {
      inFlightReloads.delete(name);
    }
  });

  return r;
}

async function doHotReload(name: string): Promise<
  | { ok: true; sha: string; branch: string; cronCount: number }
  | { ok: false; error: string; stage: string }
> {
  // 1. 옛 cron 트리거 해제 (모듈 캐시 비우기 전에)
  getCronScheduler().cancelAgent(name);

  // 2. git fetch + 부분 checkout
  let sha: string;
  let branch: string;
  try {
    const r = await fetchLearnerFolder(name);
    sha = r.sha;
    branch = r.branch;
  } catch (err) {
    reloadLog.error(`fetch failed for ${name}`, err);
    return { ok: false, error: (err as Error).message, stage: 'fetch' };
  }

  if (!agentFolderExists(name)) {
    return {
      ok: false,
      error: `agents/${name}/ 폴더가 그 브랜치에 없어요`,
      stage: 'after-checkout',
    };
  }

  // 3. 모듈 reload (ESM 캐시 우회)
  let agent;
  try {
    agent = await reloadAgent(name);
  } catch (err) {
    reloadLog.error(`module reload failed for ${name}`, err);
    return { ok: false, error: (err as Error).message, stage: 'module-reload' };
  }
  if (!agent) {
    return { ok: false, error: 'agent not found after reload', stage: 'module-reload' };
  }

  // 4. cron 재등록
  const cronCount = bindCronTriggers(agent);

  // 5. DB row + 매핑 동기 (실패해도 reload 자체는 성공으로 보고)
  try {
    await ensureAgentRow(agent);
    await syncManifestToolsForAgent(agent);
    await refreshSlackUserMap();
  } catch (err) {
    reloadLog.warn(`post-reload sync warned for ${name}`, err);
  }

  reloadLog.info(`reload OK: ${name} @ ${sha.slice(0, 8)} (${cronCount} cron)`);
  return { ok: true, sha, branch, cronCount };
}

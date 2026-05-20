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
} from '@rego/db';
import { listAgents, getAgent } from '../agent-registry.js';
import { audit } from '../audit.js';
import { analyzeAgent } from '../analyzer.js';

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

    return c.json({
      agent: {
        ...row,
        loaded: !!loaded,
        manifest: loaded?.manifest ?? row.currentManifest,
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

  return r;
}

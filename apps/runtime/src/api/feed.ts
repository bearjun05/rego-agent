import { Hono } from 'hono';
import { sql, desc, eq, gte, and } from 'drizzle-orm';
import {
  getDb,
  events,
  runs,
  llmCalls,
  toolCalls,
  slackMentions,
  telegramMessages,
  auditLogs,
} from '@rego/db';

export function createFeedApi() {
  const r = new Hono();

  // GET /api/feed — 통합 활동 피드 (실시간 + 최근)
  r.get('/', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const db = getDb();

    const rows = await db
      .select()
      .from(events)
      .orderBy(desc(events.createdAt))
      .limit(limit);

    return c.json({ events: rows });
  });

  // GET /api/feed/runs — 실행 이력만
  r.get('/runs', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const agent = c.req.query('agent');
    const db = getDb();

    const query = db
      .select()
      .from(runs)
      .orderBy(desc(runs.startedAt))
      .limit(limit);

    const rows = agent
      ? await db.select().from(runs).where(eq(runs.agentName, agent)).orderBy(desc(runs.startedAt)).limit(limit)
      : await query;
    return c.json({ runs: rows });
  });

  // GET /api/runs/:id — 단일 run 디테일
  r.get('/runs/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb();
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    if (!row) return c.json({ error: 'not found' }, 404);

    const llms = await db.select().from(llmCalls).where(eq(llmCalls.runId, id));
    const tools = await db.select().from(toolCalls).where(eq(toolCalls.runId, id));
    return c.json({ run: row, llms, tools });
  });

  // GET /api/feed/mentions — 멘션 → 텔레그램 매핑 전체
  r.get('/mentions', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const agent = c.req.query('agent');
    const db = getDb();

    const messages = agent
      ? await db
          .select()
          .from(telegramMessages)
          .where(eq(telegramMessages.agentName, agent))
          .orderBy(desc(telegramMessages.sentAt))
          .limit(limit)
      : await db
          .select()
          .from(telegramMessages)
          .orderBy(desc(telegramMessages.sentAt))
          .limit(limit);

    const mentionIds = messages
      .map((m) => m.triggeredBySlackMentionId)
      .filter((v): v is number => v !== null);

    let mentionMap = new Map<number, typeof slackMentions.$inferSelect>();
    if (mentionIds.length > 0) {
      const mns = await db
        .select()
        .from(slackMentions)
        .where(sql`${slackMentions.id} IN (${sql.join(mentionIds.map((id) => sql`${id}`), sql`, `)})`);
      mentionMap = new Map(mns.map((m) => [m.id, m]));
    }

    return c.json({
      flow: messages.map((m) => {
        const slack = m.triggeredBySlackMentionId
          ? mentionMap.get(m.triggeredBySlackMentionId)
          : null;
        const isTest =
          !!slack &&
          ((slack.eventId?.startsWith('smoke-') ?? false) ||
            (slack.raw as { test?: boolean } | null)?.test === true);
        return { telegram: m, slack: slack ?? null, isTest };
      }),
    });
  });

  // GET /api/admin/audit — 관리자 감사 로그
  r.get('/audit', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '100', 10);
    const severity = c.req.query('severity');
    const db = getDb();
    const rows = severity
      ? await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.severity, severity))
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
      : await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
    return c.json({ audit: rows });
  });

  // GET /api/stats — 전체 통계
  r.get('/stats', async (c) => {
    const db = getDb();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [allTime] = await db
      .select({
        cost: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)::text`,
        calls: sql<string>`COUNT(*)::text`,
      })
      .from(llmCalls);

    const [todayStats] = await db
      .select({
        cost: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)::text`,
        calls: sql<string>`COUNT(*)::text`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, today));

    const [mentionCount] = await db
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(slackMentions);

    const [runCount] = await db
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(runs);

    return c.json({
      allTime: {
        costUsd: parseFloat(allTime?.cost ?? '0'),
        llmCalls: parseInt(allTime?.calls ?? '0', 10),
        mentions: parseInt(mentionCount?.count ?? '0', 10),
        runs: parseInt(runCount?.count ?? '0', 10),
      },
      today: {
        costUsd: parseFloat(todayStats?.cost ?? '0'),
        llmCalls: parseInt(todayStats?.calls ?? '0', 10),
      },
    });
  });

  return r;
}

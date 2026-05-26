import { Hono } from 'hono';
import { sql, desc, eq, and, isNotNull } from 'drizzle-orm';
import {
  getDb,
  agents,
  runs,
  toolCalls,
  telegramMessages,
  llmCalls,
} from '@rego/db';
import { CELL_IDS, CELL_DEFS, type CellId } from '../bingo-rules.js';
import { checkAllCells } from '../bingo-checks.js';
import { buildBlueprint, loadLearnerCode } from '../insol-analyzer.js';

export function createWeek2Api() {
  const r = new Hono();

  /** 빙고 완주/진행 leaderboard */
  r.get('/leaderboard', async (c) => {
    const db = getDb();
    const all = await db.select({ name: agents.name, displayName: agents.displayName }).from(agents);
    const ranked = await Promise.all(
      all.map(async (a) => {
        const cells = await checkAllCells(a.name);
        const done = Object.values(cells).filter((s) => s === 'done').length;
        return {
          name: a.name,
          displayName: a.displayName,
          done,
          cells,
        };
      }),
    );
    ranked.sort((a, b) => b.done - a.done);
    return c.json({
      rankings: ranked.map((r, i) => ({ rank: i + 1, ...r })),
    });
  });

  /** 도구 사용 빈도 — 전체 + agent별 */
  r.get('/tool-usage', async (c) => {
    const db = getDb();
    const rows = await db
      .select({
        toolId: toolCalls.toolId,
        agentName: toolCalls.agentName,
        count: sql<number>`count(*)::int`,
      })
      .from(toolCalls)
      .where(sql`${toolCalls.error} IS NULL`)
      .groupBy(toolCalls.toolId, toolCalls.agentName);

    const byTool = new Map<string, { total: number; agents: number; users: Set<string> }>();
    for (const row of rows) {
      const e = byTool.get(row.toolId) ?? { total: 0, agents: 0, users: new Set<string>() };
      e.total += row.count;
      e.users.add(row.agentName);
      byTool.set(row.toolId, e);
    }
    const totals = Array.from(byTool.entries())
      .map(([id, e]) => ({ id, total: e.total, uniqueUsers: e.users.size }))
      .sort((a, b) => b.total - a.total);
    return c.json({ tools: totals });
  });

  /** 텔레그램 메시지 갤러리 — 각 학습자 최근 메시지 1건 (PII 마스킹) */
  r.get('/telegram-gallery', async (c) => {
    const db = getDb();
    const all = await db.select({ name: agents.name, displayName: agents.displayName }).from(agents);
    const gallery = await Promise.all(
      all.map(async (a) => {
        const [latest] = await db
          .select({
            text: telegramMessages.text,
            sentAt: telegramMessages.sentAt,
          })
          .from(telegramMessages)
          .where(eq(telegramMessages.agentName, a.name))
          .orderBy(desc(telegramMessages.sentAt))
          .limit(1);
        const masked = latest?.text
          ? latest.text
              // 슬랙 user id (U…) 마스킹
              .replace(/U[A-Z0-9]{8,}/g, 'U***')
              // 채널 id (C…) 마스킹
              .replace(/C[A-Z0-9]{8,}/g, 'C***')
          : null;
        return {
          agent: a.name,
          displayName: a.displayName,
          message: masked,
          sentAt: latest?.sentAt ?? null,
        };
      }),
    );
    return c.json({
      gallery: gallery
        .filter((g) => g.message)
        .sort((a, b) => (b.sentAt && a.sentAt ? new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime() : 0)),
    });
  });

  /** 셀별 클리어율 */
  r.get('/cell-clear-rates', async (c) => {
    const db = getDb();
    const all = await db.select({ name: agents.name }).from(agents);
    const counts: Record<CellId, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    for (const a of all) {
      const cells = await checkAllCells(a.name);
      for (const id of CELL_IDS) {
        if (cells[id] === 'done') counts[id] += 1;
      }
    }
    const total = all.length || 1;
    return c.json({
      cells: CELL_IDS.map((id) => ({
        id,
        title: CELL_DEFS[id].title,
        short: CELL_DEFS[id].short,
        done: counts[id],
        total,
        rate: counts[id] / total,
      })),
    });
  });

  /** 16명 청사진 갤러리 (간소화) */
  r.get('/blueprints', async (c) => {
    const db = getDb();
    const all = await db.select({ name: agents.name }).from(agents);
    const blueprints = await Promise.all(all.map((a) => buildBlueprint(a.name)));
    return c.json({ blueprints });
  });

  /** 라이브 활동 피드 — 최근 N건 (runs + tool_calls 합쳐서) */
  r.get('/activity-feed', async (c) => {
    const db = getDb();
    const limit = Math.min(50, Number(c.req.query('limit') ?? 30));
    const recentRuns = await db
      .select({
        agentName: runs.agentName,
        triggerType: runs.triggerType,
        status: runs.status,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .orderBy(desc(runs.startedAt))
      .limit(limit);
    return c.json({
      activity: recentRuns.map((r) => ({
        agent: r.agentName,
        type: r.triggerType,
        status: r.status,
        at: r.startedAt,
      })),
    });
  });

  return r;
}

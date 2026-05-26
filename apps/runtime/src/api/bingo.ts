import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { getDb, kvState, agents, runs, telegramMessages } from '@rego/db';
import { CELL_DEFS, CELL_IDS, CHAT_INPUT_CELLS, type CellId } from '../bingo-rules.js';
import { checkAllCells, checkCell } from '../bingo-checks.js';
import { createLogger } from '../logger.js';

const log = createLogger('api:bingo');

function isCellId(n: unknown): n is CellId {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 9;
}

export function createBingoApi() {
  const r = new Hono();

  /** 9칸 상태 + 셀 정의 (UI 렌더용) */
  r.get('/status', async (c) => {
    const agent = c.req.query('agent');
    if (!agent) return c.json({ error: 'agent 쿼리 필요' }, 400);
    const cells = await checkAllCells(agent);
    const defs = CELL_IDS.map((id) => CELL_DEFS[id]);
    return c.json({ agent, cells, defs });
  });

  /** 개별 셀 즉시 검증 + 이유/힌트 반환 */
  r.post('/verify', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { agent?: string; cell?: number } | null;
    const agent = body?.agent;
    const cell = body?.cell;
    if (!agent || !isCellId(cell)) {
      return c.json({ error: 'agent + cell(1~9) 필요' }, 400);
    }
    const result = await checkCell(cell, agent);
    return c.json({ ...result, cell, def: CELL_DEFS[cell] });
  });

  /** 채팅 입력 셀(6/7/9) 클레임 — 학습자 텍스트 저장 */
  r.post('/claim', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      agent?: string;
      cell?: number;
      text?: string;
    } | null;
    const agent = body?.agent;
    const cell = body?.cell;
    const text = body?.text;
    if (!agent || !isCellId(cell)) {
      return c.json({ error: 'agent + cell 필요' }, 400);
    }
    if (!CHAT_INPUT_CELLS.has(cell)) {
      return c.json({ error: '이 셀은 채팅 입력으로 클리어할 수 없어요 (자동 검증 셀)' }, 400);
    }
    if (typeof text !== 'string' || text.trim().length < 3) {
      return c.json({ passed: false, reason: '3자 이상 입력해주세요' }, 200);
    }
    const db = getDb();
    const key = `bingo:cell${cell}`;
    const value = { text: text.trim(), at: new Date().toISOString() };
    await db
      .insert(kvState)
      .values({ agentName: agent, key, value })
      .onConflictDoUpdate({
        target: [kvState.agentName, kvState.key],
        set: { value, updatedAt: new Date() },
      });
    log.info(`bingo claim: ${agent} cell ${cell}`);
    return c.json({ passed: true, reason: '저장됨' });
  });

  /**
   * 전체 학습자 모니터링 (운영자 뷰 + 채팅 monitor 카드).
   * 16명 빙고 진행률 + 마지막 활동 + 막힘 여부.
   */
  r.get('/all', async (c) => {
    const db = getDb();
    const all = await db
      .select({
        name: agents.name,
        displayName: agents.displayName,
        slackUserId: agents.slackUserId,
        telegramChatId: agents.telegramChatId,
        isPaused: agents.isPaused,
      })
      .from(agents);

    // 각 agent의 마지막 run 시각 (활동 indicator)
    const lastRuns = await db
      .select({
        agentName: runs.agentName,
        lastAt: sql<string>`max(${runs.startedAt})::text`,
      })
      .from(runs)
      .groupBy(runs.agentName);
    const lastMap = new Map(lastRuns.map((r) => [r.agentName, r.lastAt]));

    const rows = await Promise.all(
      all.map(async (a) => {
        const cells = await checkAllCells(a.name);
        const doneCount = Object.values(cells).filter((s) => s === 'done').length;
        const lastAt = lastMap.get(a.name) ?? null;
        const minsAgo = lastAt
          ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 60_000)
          : null;
        return {
          name: a.name,
          displayName: a.displayName,
          slackConnected: !!a.slackUserId, // roster 등록 = 슬랙 ID 있음
          telegramConnected: !!a.telegramChatId,
          isPaused: a.isPaused,
          bingoDone: doneCount,
          bingoCells: cells,
          lastActivityAt: lastAt,
          lastActivityMinsAgo: minsAgo,
          stuck: minsAgo !== null && minsAgo > 5 && doneCount < 9,
        };
      }),
    );

    return c.json({
      total: rows.length,
      done: rows.filter((r) => r.bingoDone === 9).length,
      active: rows.filter((r) => r.lastActivityMinsAgo !== null && r.lastActivityMinsAgo < 5).length,
      stuck: rows.filter((r) => r.stuck).length,
      rows: rows.sort((a, b) => b.bingoDone - a.bingoDone),
    });
  });

  return r;
}

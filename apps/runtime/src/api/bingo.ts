import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, kvState } from '@rego/db';
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

  return r;
}

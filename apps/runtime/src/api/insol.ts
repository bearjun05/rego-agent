import { Hono } from 'hono';
import {
  buildCellGuidance,
  buildOperatorOverview,
  loadLearnerCode,
  loadLearnerStats,
  submitPat,
  listPendingPats,
  buildBlueprint,
} from '../insol-analyzer.js';
import { type CellId } from '../bingo-rules.js';
import { createLogger } from '../logger.js';

const log = createLogger('api:insol');

function isCellId(n: unknown): n is CellId {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 9;
}

export function createInsolApi() {
  const r = new Hono();

  /** 셀별 코칭 — 학습자 현재 코드 상태에 맞춘 다음 한 줄 + 코드 스니펫 */
  r.get('/cell-guide', async (c) => {
    const cell = Number(c.req.query('cell'));
    const agent = c.req.query('agent');
    if (!isCellId(cell) || !agent) {
      return c.json({ error: 'cell(1-9) + agent 필요' }, 400);
    }
    const guidance = await buildCellGuidance(cell, agent);
    return c.json(guidance);
  });

  /** 학습자 통계 + 코드 — 리빌 + 청사진용 */
  r.get('/learner-stats', async (c) => {
    const agent = c.req.query('agent');
    if (!agent) return c.json({ error: 'agent 필요' }, 400);
    const [stats, code, blueprint] = await Promise.all([
      loadLearnerStats(agent),
      loadLearnerCode(agent),
      buildBlueprint(agent),
    ]);
    return c.json({ stats, code: { ...code, handlerSnippet: undefined, lines: code.handlerLines }, blueprint });
  });

  /** 운영자 메타 데이터 — "다른 사람 뭐해?", "막힌 사람" 등 */
  r.get('/operator-overview', async (c) => {
    const data = await buildOperatorOverview();
    return c.json(data);
  });

  /** PAT 제출 — 학습자가 인솔이에게 알려준 토큰을 큐에 저장 */
  r.post('/pat-submit', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { agent?: string; token?: string } | null;
    if (!body?.agent || typeof body.token !== 'string') {
      return c.json({ error: 'agent + token 필요' }, 400);
    }
    // 간단한 검증 — github_pat_ 또는 ghp_ 시작
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]+$/.test(body.token.trim())) {
      return c.json({ error: '올바른 GitHub PAT 형식이 아닌 것 같아요' }, 400);
    }
    await submitPat(body.agent, body.token.trim());
    log.info(`PAT submitted by ${body.agent}`);
    return c.json({ ok: true, message: '운영자에게 전달했어요!' });
  });

  /** 운영자가 대기 중인 PAT 큐 조회 (실제 토큰 값은 별도 GET으로) */
  r.get('/pat-pending', async (c) => {
    const list = await listPendingPats();
    return c.json({ pending: list });
  });

  return r;
}

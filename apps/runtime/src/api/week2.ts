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

  /**
   * 텔레그램 갤러리 — 학습자별 최근 메시지들 + 규칙 기반 추출 "기능 태그".
   * 비개발자가 한눈에 "이 사람 메시지에 어떤 기능이 들어있나" 보는 용도.
   */
  r.get('/telegram-gallery', async (c) => {
    const db = getDb();
    const all = await db.select({ name: agents.name, displayName: agents.displayName }).from(agents);
    const N = 5; // 학습자당 최근 메시지 개수
    const learners = await Promise.all(
      all.map(async (a) => {
        const recent = await db
          .select({
            text: telegramMessages.text,
            sentAt: telegramMessages.sentAt,
          })
          .from(telegramMessages)
          .where(eq(telegramMessages.agentName, a.name))
          .orderBy(desc(telegramMessages.sentAt))
          .limit(N);

        const messages = recent.map((m) => ({
          text: maskPII(m.text ?? ''),
          sentAt: m.sentAt,
        }));
        const tags = extractFeatureTags(messages.map((m) => m.text));
        return {
          agent: a.name,
          displayName: a.displayName,
          messageCount: messages.length,
          latestAt: messages[0]?.sentAt ?? null,
          tags,
          messages,
        };
      }),
    );
    return c.json({
      learners: learners
        .filter((l) => l.messageCount > 0)
        .sort((a, b) =>
          a.latestAt && b.latestAt
            ? new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
            : 0,
        ),
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

/** PII 마스킹 — Slack user/channel ID */
function maskPII(text: string): string {
  return text.replace(/U[A-Z0-9]{8,}/g, 'U***').replace(/C[A-Z0-9]{8,}/g, 'C***');
}

/**
 * 메시지 묶음에서 비개발자에게 의미 있는 "기능 태그" 추출.
 * 규칙 기반 — LLM 호출 없이 빠른 패턴 매칭.
 *
 * 태그 예시:
 *   "발신자 이름으로 표시", "채널명으로 표시", "분류 라벨", "버튼 첨부",
 *   "요약 형태", "이모지 추가", "내용 다듬음", "한국어 변환"
 */
function extractFeatureTags(messages: string[]): string[] {
  if (messages.length === 0) return [];
  const tags = new Set<string>();
  const joined = messages.join('\n');

  // 사용자/채널 ID가 마스킹 후에도 보이면 = 이름 변환 미적용
  // 마스킹 후 U***/C*** 가 있다는 건 원본에 raw ID가 있었다는 뜻
  const hasRawUserId = /U\*{3}/.test(joined);
  const hasRawChannelId = /C\*{3}/.test(joined);
  if (!hasRawUserId) tags.add('발신자 이름으로 표시');
  if (!hasRawChannelId) tags.add('채널명으로 표시');

  // 분류 라벨 — [질문] / [요청] / [일정] / [참고] 같은 패턴
  if (/\[(질문|요청|일정|참고|info|question|request|schedule|task)\]/i.test(joined)) {
    tags.add('분류 라벨');
  }

  // 버튼 첨부 — 대부분의 텔레그램 메시지 단위로는 별도 필드라 표시 안 됨.
  // 휴리스틱: "✅", "❌", "→", "버튼" 같은 흔적 또는 callback 데이터 마커
  if (/(\b답변\b|\b확인\b|\b미루기\b|\b넘기기\b).*\|/.test(joined) || /\b\[버튼\]/.test(joined)) {
    tags.add('버튼 첨부');
  }

  // 이모지 추가 — 이모지 1개라도 있으면
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(joined)) {
    tags.add('이모지 추가');
  }

  // 줄바꿈/마크다운 — `**`, `*`, `-` 리스트 마커
  if (/\n{2,}/.test(joined) || /\*\*[^*]+\*\*/.test(joined) || /^[-•]\s/m.test(joined)) {
    tags.add('내용 다듬음');
  }

  // 요약 형태 — 메시지가 4줄 이하 + 짧음
  const avgLen =
    messages.reduce((s, m) => s + m.length, 0) / Math.max(1, messages.length);
  if (avgLen < 140 && avgLen > 10) tags.add('짧게 요약');

  return Array.from(tags);
}

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
 * 메시지 묶음에서 학습자가 "직접 만든 기능"을 보수적으로 추출.
 * 기본은 태그 없음(=원본 그대로 포워딩). 명확한 가공 흔적이 있을 때만 태그 부여.
 *
 * false positive 방지가 핵심 — 학습자가 아직 안 만들었는데
 * 자동으로 태그 붙으면 "이미 한 것처럼" 보이니까.
 */
function extractFeatureTags(messages: string[]): string[] {
  if (messages.length === 0) return [];
  const tags = new Set<string>();
  const joined = messages.join('\n');

  // ① 발신자 이름으로 표시
  // "이름:" / "이름님" / "[이름]" / "by 이름" 패턴 + raw user ID(U***)가 절대 없어야.
  const hasUserId = /U\*{3}|U[A-Z0-9]{8,}/.test(joined);
  const looksLikeName =
    /\b(?:from|by)\s+[가-힣A-Za-z]{2,}\b/i.test(joined) ||
    /^[가-힣]{2,4}\s*[:：님]/m.test(joined) ||
    /\[[가-힣]{2,4}\]/.test(joined);
  if (!hasUserId && looksLikeName) tags.add('발신자 이름으로 표시');

  // ② 채널명으로 표시
  // `#채널명` 형태가 명시적으로 있어야 + raw channel id(C***) 없어야.
  const hasChannelId = /C\*{3}|C[A-Z0-9]{8,}/.test(joined);
  const looksLikeChannel = /#[가-힣A-Za-z0-9_-]{2,}/.test(joined);
  if (!hasChannelId && looksLikeChannel) tags.add('채널명으로 표시');

  // ③ 분류 라벨 — [질문]/[요청]/[일정]/[참고] 같은 명시적 라벨
  if (/\[(질문|요청|일정|참고|info|question|request|schedule|task)\]/i.test(joined)) {
    tags.add('분류 라벨');
  }

  // ④ 이모지 추가 — 의미 있는 개수(메시지 평균 1개 이상)
  const emojiCount = (joined.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (emojiCount >= messages.length) tags.add('이모지 추가');

  // ⑤ 내용 다듬음 — 마크다운 강조(`**bold**`) 명확히 사용 OR 리스트 마커 2줄 이상
  const hasBold = /\*\*[^*\n]{2,}\*\*/.test(joined);
  const listLines = (joined.match(/^[-•]\s\S/gm) || []).length;
  if (hasBold || listLines >= 2) tags.add('내용 다듬음');

  // ⑥ 한 줄 요약 — 메시지가 짧고(80자 이하) + 줄바꿈 1개 이하인 게 다수
  const oneliners = messages.filter((m) => m.length <= 80 && (m.match(/\n/g) || []).length <= 1).length;
  if (oneliners >= Math.ceil(messages.length / 2) && oneliners >= 2) {
    tags.add('한 줄 요약');
  }

  return Array.from(tags);
}

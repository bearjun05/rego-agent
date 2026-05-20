import { Hono } from 'hono';
import { z } from 'zod';
import { sql, desc, eq } from 'drizzle-orm';
import {
  getDb,
  chatMessages,
  agents,
  runs,
  llmCalls,
  slackMentions,
  telegramMessages,
} from '@rego/db';
import { callOpenRouter } from '@rego/tools/llm';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('chat');

/**
 * 단순 Q&A 챗봇 — 대시보드에서 사용자(주로 너)가 "지금 누가 잘 진행 중?",
 * "수미 에이전트는 뭘 잘해?" 같은 질문에 답변.
 *
 * 프로젝트 맥락(에이전트 목록, 최근 활동, 비용) 을 system prompt에 넣어줌.
 */
export function createChatApi() {
  const r = new Hono();

  const sendSchema = z.object({
    sessionId: z.string().min(1),
    message: z.string().min(1),
    agentName: z.string().min(1).optional(), // 매칭된 사용자(폴더 slug)
    userName: z.string().min(1).optional(), // 호칭 (성 제외 이름)
  });

  r.post('/send', async (c) => {
    const body = await c.req.json();
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { sessionId, message, agentName, userName } = parsed.data;
    const cfg = env();
    if (!cfg.OPENROUTER_API_KEY) {
      return c.json({ error: 'OpenRouter not configured' }, 503);
    }

    const db = getDb();
    await db.insert(chatMessages).values({ sessionId, agentName, role: 'user', content: message });

    const context = await buildContextSnapshot();

    // 이전 대화 (최근 24개) — 사용자별 세션이라 그 사람의 지난 질문을 기억
    const history = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(24);
    history.reverse();

    // 매칭된 사용자라면 풀네임 조회 (페르소나 개인화)
    let displayName: string | null = null;
    if (agentName) {
      const [row] = await db
        .select({ d: agents.displayName })
        .from(agents)
        .where(eq(agents.name, agentName));
      displayName = row?.d ?? null;
    }
    const callName = userName ?? displayName ?? null;
    const isFirstTurn = history.filter((h) => h.role === 'assistant').length === 0;

    const system = [
      '너는 rego-agent 스터디의 1주차 온보딩 코치야. 친근하고 간결한 한국어 존댓말을 써.',
      '스터디 개요: 비개발자들이 본인 슬랙 멘션을 처리하는 AI 비서를 8주간 직접 만든다.',
      '',
      '[오늘(1주차) 미션]',
      '- 목표: Slack에서 멘션을 받으면 Telegram으로 알림이 오는 에이전트 만들기.',
      '- 커스텀 포인트: 어떤 메시지를 받을지 / 답장을 자동으로 할지 / 버튼으로 처리할지 등 사용자가 직접 정한다.',
      '- 시작 절차: pnpm setup → agent.config.ts 트리거(trigger.slackMention()) → handler.ts에서 telegram.send → 텔레그램 봇에 /start <slug> → git push.',
      '',
      callName ? `[지금 대화 중인 사용자] 호칭: "${callName}님"${agentName ? `, 폴더 slug: "${agentName}"` : ''}` : '[사용자] 아직 이름 미확인.',
      agentName
        ? `이 사용자에게 텔레그램 연결을 안내할 땐 반드시 정확히 "/start ${agentName}" 를 보내라고 말해줘.`
        : '',
      '',
      '[응답 규칙]',
      '- 한 번에 1~2문장으로 짧게. 길어지면 자연스럽게 끊어. 사람이 메시지 보내듯.',
      '- 인사할 때 성씨는 빼고 이름만 부른다 (예: "웅준님").',
      isFirstTurn && callName
        ? '- 이번이 첫 응답이야: "안녕하세요 OO님!"으로 반갑게 맞이하고, 오늘 미션을 알려준 뒤 텔레그램에 /start <slug> 보내보라고 안내해.'
        : '- 사용자의 질문에 오늘 미션·커스텀 포인트·프로젝트 맥락을 바탕으로 도움을 줘.',
      '- 모르면 모른다고 하고, 막연한 칭찬/사족은 빼.',
      '',
      '[프로젝트 상태 (실시간)]',
      JSON.stringify(context, null, 2),
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const { result } = await callOpenRouter({
        apiKey: cfg.OPENROUTER_API_KEY,
        model: cfg.MODEL_CHAT,
        system,
        messages: history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        temperature: 0.7,
        maxTokens: 800,
      });
      const answer = result.choices[0]?.message?.content ?? '...';
      const costUsd =
        result.usage?.cost ??
        ((result.usage?.prompt_tokens ?? 0) * 3 + (result.usage?.completion_tokens ?? 0) * 15) /
          1_000_000;

      await db.insert(chatMessages).values({
        sessionId,
        agentName,
        role: 'assistant',
        content: answer,
        contextSnapshot: context,
        costUsd: costUsd.toFixed(6),
      });

      return c.json({ answer, costUsd, model: cfg.MODEL_CHAT });
    } catch (err) {
      log.error('chat failed', err);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  r.get('/history', async (c) => {
    const sessionId = c.req.query('sessionId');
    if (!sessionId) return c.json({ error: 'sessionId required' }, 400);
    const db = getDb();
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
    return c.json({ messages: rows });
  });

  return r;
}

async function buildContextSnapshot() {
  const db = getDb();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const allAgents = await db.select().from(agents);

  const stats = await Promise.all(
    allAgents.map(async (a) => {
      const [costRow] = await db
        .select({ cost: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)::text` })
        .from(llmCalls)
        .where(eq(llmCalls.agentName, a.name));
      const [runCount] = await db
        .select({ c: sql<string>`COUNT(*)::text` })
        .from(runs)
        .where(eq(runs.agentName, a.name));
      const [mentionCount] = await db
        .select({ c: sql<string>`COUNT(*)::text` })
        .from(telegramMessages)
        .where(eq(telegramMessages.agentName, a.name));
      return {
        name: a.name,
        displayName: a.displayName,
        icon: a.icon,
        isPaused: a.isPaused,
        totalCostUsd: parseFloat(costRow?.cost ?? '0'),
        totalRuns: parseInt(runCount?.c ?? '0', 10),
        totalMentionsHandled: parseInt(mentionCount?.c ?? '0', 10),
      };
    }),
  );

  const recentRuns = await db
    .select()
    .from(runs)
    .orderBy(desc(runs.startedAt))
    .limit(10);

  return {
    agents: stats,
    recentRuns: recentRuns.map((r) => ({
      agentName: r.agentName,
      triggerType: r.triggerType,
      status: r.status,
      durationMs: r.durationMs,
      startedAt: r.startedAt,
    })),
  };
}

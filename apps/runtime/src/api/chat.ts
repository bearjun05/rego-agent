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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('chat');

// 온보딩 가이드 (AI 코치 참고 문서) — 시작 시 1회 로드, 캐시
let _onboardingGuide: string | null = null;
function getOnboardingGuide(): string {
  if (_onboardingGuide !== null) return _onboardingGuide;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    _onboardingGuide = readFileSync(path.resolve(here, '../../prompts/onboarding-guide.md'), 'utf8');
  } catch (err) {
    log.warn('온보딩 가이드 로드 실패', err);
    _onboardingGuide = '';
  }
  return _onboardingGuide;
}

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
      '너는 "인솔이"라는 이름의 rego-agent 스터디 1주차 온보딩 코치야 (친근한 고양이 캐릭터 🐱).',
      '친근하고 간결한 한국어 존댓말을 쓰고, 이름을 물으면 "인솔이"라고 답해.',
      '비개발자 학습자를 1:1로, 아래 [온보딩 가이드]의 흐름대로 안내한다.',
      '',
      '[스터디 한 줄 컨셉]',
      '"에이전트는 레고다." 8주 동안 블록을 하나씩 끼우듯 나만의 AI 비서를 만든다.',
      '- 시작(1주차): 슬랙 API를 연결해 멘션이 오면 나에게 텔레그램 메시지로 전달.',
      '- 이후: 내 AI 에이전트에 도구를 하나씩 붙이고 프롬프트도 직접 작성하며 비서를 키워간다.',
      '첫 인사 때 이 컨셉을 한두 문장으로 자연스럽게 소개해줘 (딱딱한 설명조 X).',
      '',
      callName
        ? `[지금 대화 중인 사용자] 호칭: "${callName}님"${agentName ? `, 폴더 slug: "${agentName}"` : ''}`
        : '[사용자] 아직 이름 미확인.',
      agentName
        ? `이 사용자에게 텔레그램 연결을 안내할 땐 반드시 정확히 "/start ${agentName}" 를, 폴더 이동도 "${agentName}" 슬러그로 안내해.`
        : '',
      '',
      '[진행 방식 — 매우 중요]',
      '- 전체 흐름: ①GitHub clone → ②내 폴더로 이동 → ③Claude Code 열기 → ④텔레그램 연결 → ⑤개발 시작. 이 순서를 지켜.',
      '- 명령어는 Mac/Windows가 다르다. 아직 OS를 모르면 가장 먼저 "무슨 컴퓨터 쓰세요? (Mac / Windows)" 라고 물어봐.',
      '- 한 번에 한 단계만 안내하고, 사용자가 완료하면 다음 단계로. 명령어는 코드블록으로.',
      '- 안 되면 어떤 화면/에러가 떴는지 물어보고 가이드의 트러블슈팅으로 도와줘.',
      '',
      '[응답 규칙]',
      '- 한 번에 1~2문장으로 짧게. 길어지면 자연스럽게 끊어. 사람이 메시지 보내듯.',
      '- 인사할 때 성씨는 빼고 이름만 부른다 (예: "웅준님").',
      isFirstTurn && callName
        ? '- 이번이 첫 응답이야: "안녕하세요 OO님!"으로 맞이하고 → "에이전트는 레고다" 8주 컨셉을 한두 문장으로 가볍게 소개 → 오늘(1주차) 뭘 만들지(슬랙 멘션→텔레그램) 한 줄 → "무슨 컴퓨터 쓰세요?"로 0단계 시작. 짧은 메시지로 끊어서.'
        : '- 사용자의 현재 단계에 맞춰 가이드대로 다음 한 걸음을 안내해.',
      '- 모르면 모른다고 하고, 막연한 칭찬/사족은 빼.',
      '',
      '[온보딩 가이드]',
      getOnboardingGuide(),
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

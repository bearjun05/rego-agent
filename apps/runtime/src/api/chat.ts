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
import { CELL_DEFS, CELL_IDS, type CellId } from '../bingo-rules.js';
import { checkAllCells } from '../bingo-checks.js';
import { loadLearnerCode, buildOperatorOverview } from '../insol-analyzer.js';
import { currentWeek, weekLabel } from '../study-week.js';
import { buildInsolStaticPrompt } from '../insol-prompt.js';
import type { ToolDef, ToolCall } from '@rego/tools/llm';

const log = createLogger('chat');

// 온보딩 가이드 — 시작 시 1회 로드, 캐시 (보조 컨텍스트)
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

    // 매칭된 사용자라면 풀네임 + 텔레그램 등록 여부 조회
    let displayName: string | null = null;
    let telegramRegistered = false;
    if (agentName) {
      const [row] = await db
        .select({ d: agents.displayName, chatId: agents.telegramChatId })
        .from(agents)
        .where(eq(agents.name, agentName));
      displayName = row?.d ?? null;
      telegramRegistered = !!row?.chatId;
    }
    const callName = userName ?? displayName ?? null;
    const isFirstTurn = history.filter((h) => h.role === 'assistant').length === 0;

    // 빙고 진행 상태 + 학습자 코드 + 운영자 모드 — 시스템 프롬프트 컨텍스트
    let bingoSummary = '';
    let codeContext = '';
    let operatorContext = '';
    if (agentName) {
      try {
        const cells = await checkAllCells(agentName);
        const lines = CELL_IDS.map((id) => {
          const def = CELL_DEFS[id];
          const mark = cells[id] === 'done' ? '✅' : '○';
          return `${mark} ${id}. ${def.title}`;
        });
        const doneCount = Object.values(cells).filter((s) => s === 'done').length;
        bingoSummary =
          `[학습자 빙고 진행: ${doneCount}/9]\n` +
          lines.join('\n') +
          '\n\n각 빙고 칸 안내:\n' +
          CELL_IDS.map((id) => {
            const def = CELL_DEFS[id];
            return `  ${id}. ${def.title} — ${def.description}\n     힌트: ${def.hint}`;
          }).join('\n');
      } catch (err) {
        log.warn('bingo status load failed', err);
      }

      // 학습자 코드 핵심 정보 (요약, 전체 코드는 길어서 안 박음)
      try {
        const code = await loadLearnerCode(agentName);
        if (code.handlerExists) {
          codeContext = [
            '[학습자 현재 코드 상태]',
            `핸들러 라인수: ${code.handlerLines}`,
            `등록 트리거: ${code.triggers.join(', ') || '(없음)'}`,
            `호출하는 도구: ${code.usedTools.join(', ') || '(없음)'}`,
          ].join('\n');
        } else {
          codeContext = '[학습자 코드 상태] agents/' + agentName + '/handler.ts 가 아직 없음';
        }
      } catch {}

      // 운영자(uj_choe) 면 전체 학습자 데이터 추가
      if (agentName === 'uj_choe') {
        try {
          const ov = await buildOperatorOverview();
          operatorContext = [
            '',
            '[운영자 모드 — 너는 지금 운영자(준)와 대화 중]',
            `전체 학습자: ${ov.total} / 완주: ${ov.done} / 활동중: ${ov.active} / 막힘: ${ov.stuck}`,
            `상위 진행자: ${ov.topPerformers.map((p) => `${p.name}(${p.cellsDone})`).join(', ')}`,
            `막힌 학습자: ${ov.stuckAgents.map((a) => `${a.name}(${a.cellsDone}/9, ${a.minsSinceActivity}분 정체)`).join(', ') || '(없음)'}`,
            `인기 도구: ${ov.toolPopularity.map((t) => `${t.id}(${t.calls})`).join(', ')}`,
            '운영자가 "막힌 사람", "전체 진행", "다른 사람들" 등 물어보면 위 데이터 활용해 답변.',
          ].join('\n');
        } catch {}
      }
    }

    // ─────────────────────────────────────────────────────────
    //  시스템 프롬프트 = 정적 (.md 파일 6개 합침) + 동적 컨텍스트
    //  - 정적: prompts/insol/*.md (식별, 스터디, 철학, 미션, 스타일, 카드)
    //  - 동적: 빙고/코드/운영자/텔레그램 상태 (매 요청)
    //  - 카드 트리거는 LLM tool calling으로 결정 (정규식 X)
    // ─────────────────────────────────────────────────────────

    const staticPrompt = buildInsolStaticPrompt({ callName, agentName });

    // 현재 주차 강조 — 시스템 프롬프트 최상단에 박아 모델이 "1주차" 오인 못 하게
    const todayStr = new Date().toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    const nowBlock = `# 🗓 [현재 주차 — 절대 오인 금지]
오늘은 ${todayStr} · **${weekLabel()}** (${currentWeek()}주차) 진행 중.
학습자가 "오늘 몇 주차?" 같이 물으면 반드시 "${weekLabel()}"라고 답해.
프롬프트 어디에 "1주차"가 등장해도 그건 커리큘럼 단계 설명일 뿐, 현재 시점이 아님.`;

    const firstTurnHint =
      isFirstTurn && callName
        ? `[첫 응답 가이드] "안녕하세요 ${callName}님!" → 이번 주차에 뭘 할지 한 줄 → 진행 상황 짧게 → 다음 한 걸음 물어보기. 길지 않게.`
        : '';

    // 사용자 메시지에 창조주/웅준 키워드 감지 → 강력 reminder 주입
    const lastUserMsg = history.filter((h) => h.role === 'user').slice(-1)[0]?.content ?? '';
    const creatorIntent = /창조주|웅준|준\s*님|준이|준은|준\s*어떤|준\s*누구|운영자\s*어떤|운영자\s*누구|만든\s*사람|개발자\s*어떤/.test(
      lastUserMsg,
    );
    const creatorReminder = creatorIntent
      ? `\n[★★★ 학습자가 창조주에 대해 물었어]
study.md의 [창조주에 대해 더 자세히 물으면] 섹션을 반드시 자기 말투로 풀어서 답해.
핵심 키워드 반드시 포함: 창의적인 괴짜, "하던 대로" 싫어함, 물리학·양자역학에 푹 빠짐, 본업 문제 해결 단서, 괴짜스러움 숨김, 열린 마음.
추측 묘사("기획력 + 엔지니어링" 같은 것) 금지.`
      : '';

    const dynamicContext = [
      firstTurnHint,
      creatorReminder,
      bingoSummary,
      codeContext,
      operatorContext,
      telegramRegistered
        ? '[텔레그램] 등록 완료 ✓'
        : agentName
          ? `[텔레그램] 미등록 — 학습자에게 안내: @rego_agent_bot 채팅 시작 후 \`/start ${agentName}\` 입력`
          : '',
      '',
      '[온보딩 가이드 — 참고용]',
      getOnboardingGuide(),
      '',
      '[실시간 프로젝트 상태]',
      JSON.stringify(context, null, 2),
    ]
      .filter(Boolean)
      .join('\n');

    const system =
      nowBlock + '\n\n---\n\n' + staticPrompt + '\n\n---\n\n# 동적 컨텍스트 (이번 턴)\n\n' + dynamicContext;

    // ─────────────────────────────────────────────────────────
    //  Tool 정의 — 카드 첨부를 모델이 결정
    // ─────────────────────────────────────────────────────────
    const tools: ToolDef[] = [
      {
        type: 'function',
        function: {
          name: 'show_monitor_card',
          description:
            '16명 학습자의 빙고 진행률·활동을 한눈에 보는 카드를 띄움. 사용자가 "다른 사람들 뭐해?", "전체 진행", "누가 막혔어?" 같은 의도를 보일 때 호출.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'show_theme_picker',
          description:
            '4개의 추천 테마를 카드로 띄움. 사용자가 테마/디자인/분위기 변경 의도를 보일 때 호출.',
          parameters: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: ['dark', 'pastel', 'simple', 'vintage', 'lego-bright', 'general'],
                description:
                  '추천 톤 카테고리. dark=어두운, pastel=부드러운, simple=미니멀, vintage=따뜻한, lego-bright=정통 레고, general=대표 4종',
              },
            },
            required: ['category'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'show_oauth_card',
          description: '[Slack 인증하기] 버튼 카드를 띄움. 사용자가 OAuth/슬랙 연결 시작을 원할 때.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'show_reload_button',
          description:
            '[내 코드 적용하기] 버튼 카드를 띄움. 사용자가 본인 코드를 서버에 반영하려고 할 때.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'show_bingo_board',
          description: '본인 빙고판을 띄움. 사용자가 진행 상황을 보고 싶어할 때.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    try {
      const { result } = await callOpenRouter({
        apiKey: cfg.OPENROUTER_API_KEY,
        model: cfg.MODEL_CHAT,
        system,
        messages: history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        temperature: 0.7,
        maxTokens: 800,
        tools,
        toolChoice: 'auto',
      });
      const message = result.choices[0]?.message;
      const rawAnswer = message?.content ?? '';
      const toolCalls = message?.tool_calls ?? [];
      // 운영자 모드(uj_choe)는 필터링 안 함 — 본인이 자기 시스템 보는 거니까
      const answer =
        agentName === 'uj_choe' ? rawAnswer : sanitizeModelLeak(rawAnswer);

      // Tool calls → actions[] (클라이언트가 카드 렌더링)
      const actions = toolCalls
        .map((tc: ToolCall) => parseToolCallToAction(tc, agentName))
        .filter(Boolean);

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

      return c.json({ answer, actions, costUsd, model: cfg.MODEL_CHAT });
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

/**
 * 모델·API·내부 구조 노출 감지 → 응답 교체.
 *
 * LLM이 가드레일 프롬프트를 무시하고 "저는 Claude예요" 같이 답할 때,
 * 키워드 매칭으로 catch 해서 정해진 거절 응답으로 교체.
 *
 * 매우 보수적 — 의심되는 키워드 있으면 무조건 교체.
 * 운영자(uj_choe) 모드는 호출 측에서 우회.
 */
function sanitizeModelLeak(answer: string): string {
  const lower = answer.toLowerCase();
  // 모델/API 노출 의심 키워드
  const leakPatterns = [
    /\bclaude\b/i,
    /\bsonnet\b/i,
    /\bhaiku\b/i,
    /\bopus\b/i,
    /\banthropic\b/i,
    /\bgpt[-]?[0-9o]?/i,
    /\bopenai\b/i,
    /\bdeepseek\b/i,
    /\bopenrouter\b/i,
    /\bgemini\b/i,
    /\bllama\b/i,
    /\bmistral\b/i,
    /\bgrok\b/i,
    /llm\s*api/i,
    /system\s*prompt/i,
    /시스템\s*프롬프트/i,
    /시스템\s*메시지/i,
  ];
  const leaked = leakPatterns.some((p) => p.test(lower));
  if (!leaked) return answer;
  // 교체
  return [
    '에이~ 그건 영업 비밀이에요 🤫',
    '쓰는 모델이나 내부 구조는 창조주가 알려주지 말래요 ㅋㅋ',
    '대신 다른 거 도와드릴게요!',
    '- 빙고 어디까지 푸셨어요?',
    '- 다음 빙고 뭐 풀어야 할지 알려드릴까요?',
    '- 다른 분들 진행 상황 보시려면 "다른 사람들 뭐해?"',
  ].join('\n');
}

/**
 * LLM tool_call → 클라이언트가 렌더할 action으로 변환.
 * 카드 종류별 payload 표준화.
 */
function parseToolCallToAction(
  tc: ToolCall,
  agentName?: string,
): { type: string; [key: string]: unknown } | null {
  let args: Record<string, unknown> = {};
  try {
    args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
  } catch {}
  switch (tc.function.name) {
    case 'show_monitor_card':
      return { type: 'monitor' };
    case 'show_theme_picker':
      return { type: 'theme-picker', category: (args.category as string) ?? 'general' };
    case 'show_oauth_card':
      return agentName ? { type: 'oauth', agentSlug: agentName } : null;
    case 'show_reload_button':
      return agentName ? { type: 'reload', agentSlug: agentName } : null;
    case 'show_bingo_board':
      return agentName ? { type: 'bingo', agentSlug: agentName } : null;
    default:
      return null;
  }
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

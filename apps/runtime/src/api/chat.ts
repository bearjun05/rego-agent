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
          '\n\n각 셀 안내:\n' +
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

    const firstTurnHint =
      isFirstTurn && callName
        ? `[첫 응답 가이드] "안녕하세요 ${callName}님!" → 이번 주차에 뭘 할지 한 줄 → 진행 상황 짧게 → 다음 한 걸음 물어보기. 길지 않게.`
        : '';

    const dynamicContext = [
      firstTurnHint,
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

    const system = staticPrompt + '\n\n---\n\n# 동적 컨텍스트 (이번 턴)\n\n' + dynamicContext;

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
      const answer = message?.content ?? '';
      const toolCalls = message?.tool_calls ?? [];

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

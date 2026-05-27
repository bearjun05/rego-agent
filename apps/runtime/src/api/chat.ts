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
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { createLogger } from '../logger.js';
import { CELL_DEFS, CELL_IDS, type CellId } from '../bingo-rules.js';
import { checkAllCells } from '../bingo-checks.js';
import { loadLearnerCode, buildOperatorOverview } from '../insol-analyzer.js';
import { currentWeek, weekLabel } from '../study-week.js';
import { buildInsolStaticPrompt } from '../insol-prompt.js';
import { loadAllPrereqs, type LearnerPrereqs } from '../learner-status.js';
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
      {
        type: 'function',
        function: {
          name: 'update_call_name',
          description:
            '사용자가 호칭/이름을 정정할 때. "내 이름은 X" / "X라고 불러줘" / "사실 X야" 같은 의도. 명단 매칭이 새로 가능하면 slug도 같이.',
          parameters: {
            type: 'object',
            properties: {
              newCallName: { type: 'string', description: '새 호칭' },
              slug: {
                type: 'string',
                description: '명단 매칭 가능하면 roster slug. 매칭 안 되면 비움.',
              },
            },
            required: ['newCallName'],
          },
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

  // ─────────────────────────────────────────────────────────
  //  POST /bootstrap — 첫 인사 자연어 처리
  //  사용자 첫 메시지 + roster → LLM이 도구 호출로 정체 판단 + 환영 멘트
  //  (HomeChat.tsx의 정규식 매칭을 대체)
  // ─────────────────────────────────────────────────────────
  const bootstrapSchema = z.object({
    sessionId: z.string().min(1),
    message: z.string().min(1),
  });

  r.post('/bootstrap', async (c) => {
    const body = await c.req.json();
    const parsed = bootstrapSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { sessionId, message } = parsed.data;
    const cfg = env();
    if (!cfg.OPENROUTER_API_KEY) {
      return c.json({ error: 'OpenRouter not configured' }, 503);
    }

    const db = getDb();

    // roster — agents 테이블의 displayName 있는 사용자만
    const allAgents = await db
      .select({ slug: agents.name, displayName: agents.displayName })
      .from(agents);
    const roster = allAgents
      .filter((a) => a.displayName && a.slug !== '_template')
      .map((a) => ({ slug: a.slug, displayName: a.displayName as string }));

    // 시스템 프롬프트: guardrails + welcome (간결)
    const here = path.dirname(fileURLToPath(import.meta.url));
    const promptDir = path.resolve(here, '../../prompts/insol');
    const loadMd = (n: string) => {
      const f = path.join(promptDir, `${n}.md`);
      return existsSync(f) ? readFileSync(f, 'utf8') : '';
    };
    const guardrails = loadMd('guardrails');
    const welcome = loadMd('welcome');

    const rosterTable = roster
      .map((r) => `- slug: ${r.slug.padEnd(20)} displayName: ${r.displayName}`)
      .join('\n');

    // 16명 1주차 선행 상태 — LLM이 매칭 후 미완 항목부터 안내하도록
    let prereqsTable = '';
    try {
      const all = await loadAllPrereqs();
      prereqsTable = Object.values(all)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map(
          (p) =>
            `- ${p.slug.padEnd(15)} 폴더 ${p.folderOk ? '✓' : '✗'} | 브랜치 ${p.branchOk ? '✓' : '✗'} | 슬랙OAuth ${p.slackOk ? '✓' : '✗'} | 텔레그램 ${p.telegramOk ? '✓' : '✗'}`,
        )
        .join('\n');
    } catch (err) {
      log.warn('prereqs load failed for bootstrap', err);
    }

    const system = [
      `# 🗓 오늘은 **${weekLabel()}** (${currentWeek()}주차) 진행 중.`,
      '',
      '---',
      guardrails,
      '---',
      welcome,
      '---',
      '## 학습자 명단 (roster) — 이 표 기준으로 매칭',
      rosterTable,
      '',
      '운영자 별칭(준/웅준/창조주/ujchoe 등) → uj_choe 슬러그로 매칭.',
      '',
      '---',
      '## 학습자 1주차 선행 단계 완료 현황',
      prereqsTable || '(상태 조회 실패)',
      '',
      '**식별된 학습자(identify_learner 호출 결과의 slug) 줄을 보고 미완(✗) 항목이 있으면',
      '환영 멘트에 그것부터 부드럽게 안내해. 미완이 여러 개면 우선순위:',
      '1. 텔레그램 ✗ → "@rego_agent_bot에서 `/start <slug>` 입력해주세요"',
      '2. 슬랙 OAuth ✗ → "슬랙 인증부터 같이 해볼까요?" (이건 채팅 메인에서 show_oauth_card 도구로)',
      '3. 브랜치 ✗ → "슬랙 OAuth 끝나면 자동으로 만들어져요" (정상 진행 안내)',
      '4. 폴더 ✗ → 운영자에게 알리도록 안내 (드뭄)',
      '모두 ✓ → 2주차 빙고 진행 안내.',
      '톤: "안녕하세요 X님! 1주차에 했던 거 보니까 텔레그램이 아직이에요. 그것부터 같이 해볼까요?" 식.**',
    ].join('\n');

    const tools: ToolDef[] = [
      {
        type: 'function',
        function: {
          name: 'identify_learner',
          description:
            '사용자가 학습자 명단에 매칭될 때 호출. 운영자(웅준/창조주/uj_choe 등)도 학습자로 처리.',
          parameters: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'roster의 slug 그대로' },
              callName: { type: 'string', description: '친근하게 부를 호칭 (이름)' },
            },
            required: ['slug', 'callName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'identify_guest',
          description: '이름은 있는데 명단에 없는 외부 손님일 때.',
          parameters: {
            type: 'object',
            properties: {
              callName: { type: 'string', description: '사용자가 알려준 이름' },
            },
            required: ['callName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ask_again',
          description: '이름이 안 보이거나 인사/이모티콘만 보낸 경우. 다시 묻기.',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: '왜 다시 묻는지 한 줄' },
            },
            required: ['reason'],
          },
        },
      },
    ];

    try {
      const { result } = await callOpenRouter({
        apiKey: cfg.OPENROUTER_API_KEY,
        model: cfg.MODEL_CHAT,
        system,
        messages: [{ role: 'user', content: message }],
        temperature: 0.4,
        maxTokens: 500,
        tools,
        toolChoice: 'required',
      });
      const msg = result.choices[0]?.message;
      const toolCalls = msg?.tool_calls ?? [];
      const welcomeText = msg?.content ?? '';

      let identified: 'learner' | 'guest' | 'none' = 'none';
      let slug: string | null = null;
      let callName: string | null = null;
      let prereqs: LearnerPrereqs | null = null;

      const tc = toolCalls[0];
      if (tc) {
        let args: Record<string, unknown> = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {}
        if (tc.function.name === 'identify_learner') {
          const candidateSlug = String(args.slug ?? '').trim();
          // roster에 실제 존재하는 slug만 받아들임 (LLM 환각 방지)
          if (roster.find((r) => r.slug === candidateSlug)) {
            identified = 'learner';
            slug = candidateSlug;
            callName = String(args.callName ?? '').trim() || null;
          } else {
            // 매칭 실패면 게스트로 강등 (안전망)
            identified = 'guest';
            callName = String(args.callName ?? '').trim() || null;
          }
        } else if (tc.function.name === 'identify_guest') {
          identified = 'guest';
          callName = String(args.callName ?? '').trim() || null;
        } else if (tc.function.name === 'ask_again') {
          identified = 'none';
        }
      }

      // 폴백 환영 텍스트 — LLM이 답변 텍스트 안 줬을 때
      const fallbackWelcome =
        identified === 'learner' && slug === 'uj_choe'
          ? `창조주 오셨군요 ㅋㅋ\n오늘은 **${weekLabel()}** 이에요. 16명 학습자 진행 상황은 "다른 사람들 뭐해?" 한 마디면 다 보여드려요.\n필요한 거 있으면 바로 말씀하세요! 🐱`
          : identified === 'learner'
            ? `안녕하세요 ${callName}님! 👋\n오늘은 **${weekLabel()}** 이에요. 슬랙 멘션이 오면 텔레그램으로 받아보는 에이전트를 같이 만들어볼 거예요.\n빙고 3줄 완성이 오늘 목표! 오른쪽에 빙고판 띄워둘게요 🧱`
            : identified === 'guest'
              ? `반가워요 ${callName}님! 🐱\n여기는 **인프피솔루션** — 팀스파르타 사내 스터디예요. "에이전트는 레고다"가 컨셉이에요.\n아쉽게도 중간 참여는 안 되지만, 다른 분들 진행 상황 보여드릴 수 있어요. "다른 사람들 뭐해?" 한번 물어봐요!`
              : `안녕하세요! 저는 인솔이예요 🐱\n이름이 뭐예요? (예: "최웅준" 또는 그냥 "웅준")`;

      const welcomeMessage = welcomeText.trim() || fallbackWelcome;

      // prereqs는 위에서 한 번 다 조회했지만, 응답에는 식별된 slug 것만 노출
      if (slug) {
        try {
          const all = await loadAllPrereqs();
          prereqs = all[slug] ?? null;
          log.info(`bootstrap prereqs for ${slug}`, prereqs as Record<string, unknown> | null);
        } catch (err) {
          log.warn('prereqs load failed', err);
        }
      }

      // chat history에도 기록 (이후 채팅에서 컨텍스트로 활용)
      await db
        .insert(chatMessages)
        .values({ sessionId, agentName: slug ?? undefined, role: 'user', content: message });
      await db.insert(chatMessages).values({
        sessionId,
        agentName: slug ?? undefined,
        role: 'assistant',
        content: welcomeMessage,
      });

      return c.json({ identified, slug, callName, welcomeMessage, prereqs });
    } catch (err) {
      log.error('bootstrap failed', err);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
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
    case 'update_call_name': {
      const newName = String(args.newCallName ?? '').trim();
      const newSlug = args.slug ? String(args.slug).trim() : '';
      if (!newName) return null;
      return {
        type: 'update-name',
        newCallName: newName,
        ...(newSlug ? { slug: newSlug } : {}),
      };
    }
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

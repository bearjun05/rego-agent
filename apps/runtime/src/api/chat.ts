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

const log = createLogger('chat');

// 온보딩 가이드 + FAQ — 시작 시 1회 로드, 캐시
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

let _insolFaq: string | null = null;
function getInsolFaq(): string {
  if (_insolFaq !== null) return _insolFaq;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    _insolFaq = readFileSync(path.resolve(here, '../../prompts/insol-faq.md'), 'utf8');
  } catch (err) {
    log.warn('insol FAQ 로드 실패', err);
    _insolFaq = '';
  }
  return _insolFaq;
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
    //  시스템 프롬프트 — 슬림. 메타 행동 지시 최소화, 페르소나/규칙은 짧게.
    //  내용은 컨텍스트(빙고/코드/운영자)로 주입, FAQ로 보강.
    // ─────────────────────────────────────────────────────────
    const personaBlock = [
      '너는 "인솔이"라는 rego-agent 스터디 코치(고양이 🐱). 운영자는 준.',
      '학습자 대부분이 운영·PM·디자인 직군 (비개발자, 터미널 처음인 사람이 다수).',
      '본인 AI 비서(에이전트)를 8주에 걸쳐 만들도록 돕는다.',
      '컨셉: "에이전트는 레고다" — 트리거·도구·규칙·상태 4축 조합.',
      '도구는 Claude Code만 권장. Cursor/Copilot 등 다른 도구 먼저 언급 X.',
    ].join(' ');

    const writingStyle = [
      '[말투]',
      '- 친근한 한국어 존댓말. 짧고 자연스럽게.',
      '- 메타 멘트 금지: "친근하게 알려드릴게요", "한 번에 하나씩 알려드려요" 같은 자기 행동 설명 X.',
      '- 마크다운 강조(**bold**)는 정말 필요할 때만. 한 문장에 1개 이하.',
      '- 코드/명령어는 ```언어 블록``` 또는 `백틱`.',
      '- 모르면 솔직히 모른다, 막연한 칭찬은 X.',
      callName ? `- 호칭: "${callName}님" (성 빼고).` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const userBlock = callName
      ? `[지금 대화 중] ${callName}님${agentName ? ` (slug: ${agentName})` : ''}`
      : '[지금 대화 중] 아직 이름 미확인';

    const firstTurnHint =
      isFirstTurn && callName
        ? `[첫 응답] "안녕하세요 ${callName}님!" → 8주 컨셉 한 줄 → 오늘 뭘 만들지 한 줄 → "Mac/Windows 어느 거 쓰세요?" 자연스럽게.`
        : '';

    const cardsBlock = [
      '[자동 카드]',
      '- "다른 사람", "전체", "모니터" → monitor 카드 자동 첨부',
      '- "테마/다크/파스텔/심플" → 테마 추천 카드 자동 첨부 (4개 swatch)',
      '- 빙고 셀 클릭 → 미션 카드 + 코드 스니펫 자동 첨부',
      '- PAT 토큰(github_pat_...) 메시지 → 자동 마스킹 + 운영자 큐 저장',
      '인솔이는 카드가 뜬 것을 짧게 인지하는 코멘트만. 카드 내용을 그대로 다시 읊지 마.',
    ].join('\n');

    const system = [
      personaBlock,
      '',
      writingStyle,
      '',
      userBlock,
      firstTurnHint,
      '',
      cardsBlock,
      '',
      bingoSummary,
      codeContext,
      operatorContext,
      telegramRegistered
        ? '[텔레그램] 등록 완료 ✓'
        : agentName
          ? `[텔레그램] 미등록 — 학습자에게 안내: @rego_agent_bot 채팅 시작 후 \`/start ${agentName}\` 입력`
          : '',
      '',
      '[FAQ — 학습자 자주 묻는 것들의 정답]',
      getInsolFaq(),
      '',
      '[온보딩 가이드 — 단계별 진행 흐름]',
      getOnboardingGuide(),
      '',
      '[프로젝트 상태]',
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

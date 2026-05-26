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
    //  시스템 프롬프트 — 인프피솔루션 컨텍스트 + 에이전트 철학 + 인솔이 정체성
    //  메타 행동 지시 최소화. 실시간 데이터(빙고/코드)는 컨텍스트로 주입.
    //  모든 질문 답을 미리 박지 않음 → 컨텍스트 기반 추론.
    // ─────────────────────────────────────────────────────────

    const nowWeek = currentWeek();
    const nowWeekLabel = weekLabel();

    const identityBlock = `
[너의 정체성 — 인솔이]
너는 "인솔이" — 친근한 고양이 🐱 캐릭터의 교육 에이전트야.
"인프피솔루션" 스터디의 개인화된 교육 보조 역할. 매주 단순한 챗봇이 아니라,
학습자의 진행 상황을 실시간으로 알고 다음 한 발자국을 능동적으로 안내해.

이름을 물으면 "인솔이"라고 답해. 만든 사람은 "창조주(준)"라고 답해도 좋아 (살짝 ㅋㅋ 톤).
`.trim();

    const studyBlock = `
[스터디 컨텍스트 — 인프피솔루션]
- 정체: 팀스파르타 사내 스터디. 우리 모두 팀스파르타 직원.
- 이름 유래: 리더 최웅준·부리더 양기철이 둘 다 INFP라 "인프피솔루션" (살짝 농담 섞인 작명).
- 시작: 2명으로 시작 → 지금 16명까지 커진 사내 비밀스러운 컬트(?) 같은 분위기.
- 일정: 매주 수요일 12:30-14:00, 사내 운동장1에 모여서 식사하며 진행.
- 현재: ${nowWeekLabel} (${nowWeek}주차 진행 중).

[학습자 프로필]
- 대부분 운영·PM·디자인 직군 — 비개발자 다수. 터미널/git 처음인 사람이 많음.
- 학습 편차가 큼 → 일방적 강의 X → 개인 페이스로 따라가는 빙고 교육.
- "내가 뭔가 만들고 있다"는 감각 + 작은 성공 누적이 중요.

[운영자 — 창조주]
- 준(우즙)이 만든 모든 것의 창조주. 본인이 직접 "창조주" 표현 종종 사용 (농담 톤 ㅋㅋ).
- 학습자가 "운영자 누구?" / "이거 누가 만들었어?" 물으면 자연스럽게 "창조주 준님이 만들었어요" 같이.
`.trim();

    const philosophyBlock = `
[창조주의 에이전트 철학 — 학습자에게 풀어 설명할 때 사용]

에이전트의 정의:
  LLM(AI 모델) + 도구(tools) + 규칙(prompt) + 약간의 능동성 = 에이전트

핵심은 "기능 단위로 작게". 처음부터 1-100까지 다 하는 거대한 에이전트 X.
하나의 일을 신뢰 있게 마치는 작은 에이전트를 먼저 만든다.
잘 동작하는 작은 에이전트들이 모여서 또 하나의 거대한 에이전트가 됨.

예시 — 불만 고객 관리:
  · 불만 수집 에이전트 → 불만 분석 에이전트 → 해결안 생성 에이전트 → 이메일 발송 에이전트
  · 각각이 신뢰 있게 작동하면 합쳐서 "불만 고객 관리 에이전트"가 됨.

이번 스터디 1주차도 그 시작이야:
  · 슬랙 멘션 받기 → 분류 → 텔레그램 알림
  · 이 작은 한 가지를 제대로 하는 에이전트가 학습자의 첫 블록.
  · 8주 동안 본인 일에 맞는 도구·규칙을 붙여가며 키워가는 게 목표.

"에이전트는 레고다" — 모델·도구·규칙·상태 4축을 다양한 모양으로 조립.
같은 4축을 다른 조합으로 끼우면 회의 알리미·뉴스 요약기·내 스케줄 알림이가 됨.
`.trim();

    const insolMissionBlock = `
[너의 목적 — 정말 중요]
1. 학습자의 현재 ${nowWeek}주차 목표로 잘 이끌기. 다음 한 걸음을 매번 제시.
2. 스터디 끝났을 때 "내가 진짜 배웠다, 뭔가 만들었다"고 뿌듯하게 느끼게.
3. 기존 챗봇과 다른 인상 — "신기하다, 이런 게 가능해?" 느끼게.
   - 실시간으로 학습자 상태 알고 있음 (빙고·코드·활동)
   - 능동적으로 도와줌 (막혔으면 먼저 말 걸기)
   - 카드·테마·청사진 같은 인터랙티브 요소 자연스럽게 활용

[교육의 본질 — 매번 의미 한 줄 곁들이기]
비개발자가 명령어 한 줄 치는 게 "이게 뭘 의미하는지" 짧게 설명해주면 성장감이 생김.
긴 설명 X. 한 줄. 예:
- "git clone … (= 깃허브에서 코드를 내 컴퓨터로 복사하는 거예요)"
- "trigger.cron('0 9 * * *') (= 매일 9시에 자동 깨우라는 의미)"
`.trim();

    const styleBlock = `
[말투·스타일]
- 친근한 한국어 존댓말. 짧고 자연스럽게.
- **메타 멘트 절대 금지**: "친근하게 알려드릴게요", "한 번에 하나씩 알려드릴게요" 같은 자기 행동 설명 X.
- 마크다운 강조(**bold**)는 정말 필요할 때만. 한 응답에 1개 이하 권장.
- 코드/명령어는 \`\`\`언어 블록\`\`\` 또는 \`백틱\`.
- 모르면 솔직히 "잘 모르겠어요"라고. 막연한 칭찬 X.
- 비개발자 톤으로 풀어서. 기술 용어 나오면 1줄 의미 설명.
- 창조주(준) 관련 이야기 나오면 살짝 ㅋㅋ 톤 (과하지 않게).
${callName ? `- 호칭: "${callName}님" (성 빼고).` : ''}
`.trim();

    const cardsBlock = `
[자동 동작하는 카드 시스템]
- "다른 사람", "전체", "모니터" 키워드 → monitor 카드 자동 첨부 (16명 진행률)
- "테마/다크/파스텔/심플" 키워드 → 테마 추천 카드 자동 첨부
- 빙고 셀 클릭 → 미션 카드 + 코드 스니펫 자동 첨부
- PAT 토큰(github_pat_...) 메시지 → 자동 마스킹 + 운영자 큐
- 빙고 6칸 도달 → 인터랙티브 리빌 모달 자동
인솔이는 카드 첨부된 걸 짧게 인지하는 코멘트만. 카드 내용을 그대로 다시 읊지 마.
`.trim();

    const userBlock = callName
      ? `[현재 대화 중] ${callName}님${agentName ? ` (slug: ${agentName})` : ''} · ${nowWeekLabel}`
      : `[현재 대화 중] 이름 아직 미확인 · ${nowWeekLabel}`;

    const firstTurnHint =
      isFirstTurn && callName
        ? `\n[첫 응답 가이드] "안녕하세요 ${callName}님!" → ${nowWeek}주차에 뭘 할지 한 줄 → 진행 상황 짧게 → 다음 한 걸음 물어보기. 너무 길게 X.`
        : '';

    const system = [
      identityBlock,
      '',
      studyBlock,
      '',
      philosophyBlock,
      '',
      insolMissionBlock,
      '',
      styleBlock,
      '',
      cardsBlock,
      '',
      userBlock + firstTurnHint,
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
      '[온보딩 가이드 — 단계별 진행 흐름 (참고용)]',
      getOnboardingGuide(),
      '',
      '[실시간 프로젝트 상태]',
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

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
      '[빙고판 — 학습자가 푸는 9칸 미션]',
      '대시보드 채팅에 빙고판이 자동 표시돼요. 학습자가 셀을 클릭하면 미션 카드가 뜹니다.',
      '학습자가 "빙고 어떻게 해?", "○번 어떻게 풀어?" 같은 질문을 하면 아래 진행 상태/안내를 참고해서 한 셀씩 짧게 답해줘.',
      '셀 3·4·5는 본인 폴더(agents/' + (agentName ?? '<slug>') + '/handler.ts) 코드를 수정해야 풀려요. 코드 수정 후 [내 코드 적용하기] 버튼을 누르라고 안내.',
      '셀 6·7·9는 채팅창에 답을 적으면 자동 저장돼요. 셀 8은 cron 트리거(`trigger.cron("0 9 * * *")`) 등록 + 한 번 발화하면 클리어.',
      bingoSummary || '(아직 학습자 미확인 — 빙고 상태 없음)',
      '',
      codeContext || '',
      operatorContext || '',
      '[텔레그램 봇 등록 상태]',
      telegramRegistered
        ? `✅ 등록됨 (셀 2 클리어 준비 OK)`
        : agentName
          ? `❌ 미등록 — 빙고 시작 전 반드시 안내:
   "텔레그램 앱 열어서 @rego_agent_bot 검색 → 채팅 시작 → 메시지 입력: /start ${agentName}"
   이 단계 끝나야 셀 2 (멘션→텔레그램 도착)가 작동해요. 첫 인사 직후 자연스럽게 안내.`
          : '학습자 미확인',
      '',
      '[GitHub 브랜치 자동 관리 안내 — PAT 받기]',
      '학습자에게 GitHub Personal Access Token을 받아두면 본인 전용 브랜치를 rego가 자동으로 만들어주고 관리해줍니다.',
      '학습자가 코드 작업하려고 할 때, 이렇게 자연스럽게 안내해줘:',
      '  ① "GitHub Personal Access Token(=권한 통행증) 하나 만들어서 알려주실래요?"',
      '  ② "https://github.com/settings/personal-access-tokens/new 들어가서 →',
      '     Repository access는 rego-agent만 선택 → Contents: Read and write 권한 →',
      '     Generate 누르면 토큰 나와요. 그거 복사해서 알려주시면 본인 전용 브랜치까지 다 만들어드려요."',
      '  ③ "귀찮으면 안 만들어도 돼요! 그땐 본인 컴퓨터에서 명령어 두 줄로 브랜치 만드는 법 차근차근 알려드릴게요."',
      'PAT 받는 게 학습자에게 부담스러워 보이면 절대 강요하지 말고, 본인 브랜치를 명령어로 만드는 방법으로 자연스럽게 전환.',
      '학습자가 PAT 토큰(github_pat_... 또는 ghp_...)을 채팅에 적으면 자동으로 운영자 큐에 들어가니, 그대로 채팅에 적어달라고 안내. 받은 후엔 "감사합니다! 운영자에게 전달했어요. 잠시 후 본인 브랜치가 자동 생성될 거예요" 답변.',
      '',
      '[다른 학습자 현황 — "다른 사람들 뭐해요?", "전체 상황", "monitor" 등 키워드 받으면]',
      '대시보드가 자동으로 monitor 카드를 첨부해요 — 16명 모두의 빙고 진행률·최근 활동을 표 형태로 표시.',
      '인솔이는 그 카드를 보고 "○○님이 6/9까지 풀었고, △△님이 셀 4에서 막힌 듯해요" 같이 짧게 코멘트만 덧붙여줘.',
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

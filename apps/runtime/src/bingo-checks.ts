import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, sql, and, or } from 'drizzle-orm';
import {
  getDb,
  agents,
  slackUserTokens,
  toolCalls,
  runs,
  kvState,
  bingoClaims,
} from '@rego/db';
import { createLogger } from './logger.js';
import { CHAT_INPUT_CELLS, type CellId, type CellStatus } from './bingo-rules.js';
import { getAgentsRoot, getAgent } from './agent-registry.js';

const log = createLogger('bingo-checks');

export interface CheckResult {
  passed: boolean;
  reason: string;
  /** LLM 리뷰 등에서 추가 힌트 제공 가능 */
  hint?: string;
}

// ─────────────────────────────────────────────────────────
// 9칸 체크
// ─────────────────────────────────────────────────────────

export async function checkCell(cell: CellId, agentName: string): Promise<CheckResult> {
  switch (cell) {
    case 1:
      return checkOAuth(agentName);
    case 2:
      return checkFirstMentionToTelegram(agentName);
    case 3:
      return checkToolUsed(agentName, ['slack.reactions_add', 'slack.add_reaction']);
    case 4:
      return checkButtonCallback(agentName);
    case 5:
      return reviewHandlerCode(agentName, 'names');
    case 6:
    case 7:
    case 9:
      return checkChatInput(agentName, cell);
    case 8:
      return checkCronFired(agentName);
  }
}

// ─────────────────────────────────────────────────────────
// 셀 1 — OAuth
// ─────────────────────────────────────────────────────────
async function checkOAuth(agentName: string): Promise<CheckResult> {
  const db = getDb();
  const [agentRow] = await db
    .select({ slackUserId: agents.slackUserId })
    .from(agents)
    .where(eq(agents.name, agentName));
  if (!agentRow?.slackUserId) {
    return { passed: false, reason: 'agent의 slack_user_id가 등록 안 됐어요 (관리자에게 문의)' };
  }
  const [token] = await db
    .select({ revoked: slackUserTokens.revoked })
    .from(slackUserTokens)
    .where(eq(slackUserTokens.slackUserId, agentRow.slackUserId));
  if (!token) return { passed: false, reason: '아직 OAuth 안 했어요' };
  if (token.revoked) return { passed: false, reason: 'OAuth 했지만 revoke됨 — 다시 연결해주세요' };
  return { passed: true, reason: 'OAuth 완료' };
}

// ─────────────────────────────────────────────────────────
// 셀 2 — 텔레그램으로 메시지 한 번이라도 발송됐는지 (어떤 도구든, 어떤 트리거든).
//
// 의도: "본인 텔레그램에 진짜로 메시지가 갔다" 가 통과 신호. 도구 종류(send/send_with_button)나
//       매핑 테이블(telegram_messages)에 묶이지 않고 tool_calls 의 성공 호출만 본다.
// ─────────────────────────────────────────────────────────
async function checkFirstMentionToTelegram(agentName: string): Promise<CheckResult> {
  const db = getDb();
  const [r] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(toolCalls)
    .where(
      and(
        eq(toolCalls.agentName, agentName),
        sql`${toolCalls.toolId} LIKE 'telegram.send%'`,
        sql`${toolCalls.error} IS NULL`,
      ),
    );
  if (!r || r.cnt < 1) {
    return {
      passed: false,
      reason: '아직 텔레그램으로 메시지를 보낸 기록이 없어요. 본인 슬랙에서 본인을 멘션해보세요.',
    };
  }
  return { passed: true, reason: `텔레그램 ${r.cnt}건 전송됨` };
}

// ─────────────────────────────────────────────────────────
// 셀 3 — 도구 호출 로그
// ─────────────────────────────────────────────────────────
async function checkToolUsed(agentName: string, toolIds: string[]): Promise<CheckResult> {
  const db = getDb();
  const [r] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(toolCalls)
    .where(
      and(
        eq(toolCalls.agentName, agentName),
        or(...toolIds.map((id) => eq(toolCalls.toolId, id))),
        // 성공한 호출만 (error null)
        sql`${toolCalls.error} IS NULL`,
      ),
    );
  if (!r || r.cnt < 1) {
    return {
      passed: false,
      reason: `아직 [${toolIds.join(' / ')}] 도구를 호출 안 했어요`,
    };
  }
  return { passed: true, reason: `${r.cnt}회 호출됨` };
}

// ─────────────────────────────────────────────────────────
// 셀 4 — 텔레그램 콜백 라우팅 1건
// ─────────────────────────────────────────────────────────
async function checkButtonCallback(agentName: string): Promise<CheckResult> {
  const db = getDb();
  const [r] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.agentName, agentName), eq(runs.triggerType, 'telegram.callback')));
  if (!r || r.cnt < 1) {
    return {
      passed: false,
      reason: '텔레그램 버튼이 클릭된 적이 없어요. 핸들러에서 inline_keyboard로 버튼 추가 후 클릭해보세요.',
    };
  }
  return { passed: true, reason: `콜백 ${r.cnt}건 처리됨` };
}

// ─────────────────────────────────────────────────────────
// 셀 5 — 이름 변환 (handler 가 user/channel enrich 도구를 쓰는지)
//
// 통과 신호 두 가지 (OR):
//   A) 실제 도구 호출이 한 번이라도 성공 — 모든 alias(users_info/user_info/conversations_info/channel_info)
//   B) 폴백: handler.ts 코드에 호출 패턴이 보임 (학습자가 코드만 짜고 아직 발화 전이어도 인정)
// ─────────────────────────────────────────────────────────
const ENRICH_TOOL_IDS = [
  'slack.users_info',
  'slack.user_info',
  'slack.conversations_info',
  'slack.channel_info',
];

async function reviewHandlerCode(agentName: string, criterion: 'names'): Promise<CheckResult> {
  if (criterion !== 'names') {
    return { passed: false, reason: `unknown criterion: ${criterion}` };
  }

  // A) 실제 호출 — 가장 신뢰 가능한 신호
  const db = getDb();
  const [callRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(toolCalls)
    .where(
      and(
        eq(toolCalls.agentName, agentName),
        or(...ENRICH_TOOL_IDS.map((id) => eq(toolCalls.toolId, id))),
        sql`${toolCalls.error} IS NULL`,
      ),
    );
  if (callRow && callRow.cnt > 0) {
    return { passed: true, reason: `슬랙 enrich 도구 ${callRow.cnt}회 호출됨` };
  }

  // B) 정적 폴백 — 코드만 작성하고 아직 발화 안 한 경우도 인정
  const filePath = path.join(getAgentsRoot(), agentName, 'handler.ts');
  let code: string;
  try {
    code = await fs.readFile(filePath, 'utf8');
  } catch {
    return { passed: false, reason: 'handler.ts 를 읽을 수 없어요. (본인 폴더 자동 생성 대기 중일 수 있음)' };
  }
  const codeRe =
    /tools\[['"`]slack\.(users_info|user_info|conversations_info|channel_info)['"`]\]|tools\.slack\.(users_info|user_info|conversations_info|channel_info)/;
  if (codeRe.test(code)) {
    return { passed: true, reason: '핸들러에 enrich 도구 호출 패턴 감지됨 (실행은 아직 안 했어요)' };
  }
  return {
    passed: false,
    reason: '핸들러에 `slack.users_info` 또는 `slack.conversations_info` 호출이 안 보여요',
    hint:
      'await ctx.tools["slack.users_info"]({ user: event.user }) 로 이름 받아서 텔레그램에 박아보세요',
  };
}

// ─────────────────────────────────────────────────────────
// 셀 6,7,9 — 채팅 입력
// ─────────────────────────────────────────────────────────
async function checkChatInput(agentName: string, cell: CellId): Promise<CheckResult> {
  if (!CHAT_INPUT_CELLS.has(cell)) {
    return { passed: false, reason: `cell ${cell} is not chat_input` };
  }
  const db = getDb();
  const key = `bingo:cell${cell}`;
  const [row] = await db
    .select()
    .from(kvState)
    .where(and(eq(kvState.agentName, agentName), eq(kvState.key, key)));
  if (!row) return { passed: false, reason: '아직 입력 안 했어요' };
  const value = row.value as string | { text?: string } | null;
  const text = typeof value === 'string' ? value : value?.text;
  if (!text || text.trim().length < 3) {
    return { passed: false, reason: '입력이 너무 짧아요 (3자 이상)' };
  }
  return { passed: true, reason: '입력 완료' };
}

// ─────────────────────────────────────────────────────────
// 셀 8 — cron 트리거 발화 1건
// ─────────────────────────────────────────────────────────
async function checkCronFired(agentName: string): Promise<CheckResult> {
  const db = getDb();
  const [r] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.agentName, agentName), eq(runs.triggerType, 'cron')));
  if (!r || r.cnt < 1) {
    // 폴백: agent.config.ts에 cron 선언만 했으면 "곧 발화 예정"으로 알려줌
    const agent = getAgent(agentName);
    const hasCronTrigger = agent?.manifest.triggers.some(
      (t) => t.type === 'cron' && t.schedule,
    );
    if (hasCronTrigger) {
      return {
        passed: false,
        reason: 'cron 트리거 등록됨 — 다음 발화 시각을 기다리거나 onCron을 호출해 발화시키세요',
      };
    }
    return {
      passed: false,
      reason: 'agent.config.ts에 `trigger.cron("0 9 * * *")` 같은 트리거를 추가하세요',
    };
  }
  return { passed: true, reason: `cron ${r.cnt}회 발화됨` };
}

// ─────────────────────────────────────────────────────────
// 9칸 일괄 체크 (status API용).
//
// 정책: 자동 검증이 통과해도 본인이 verify 버튼을 눌러 bingo_claims 에
// 행이 들어가야만 done. 본인이 직접 풀어보고 검증받는 흐름을 강제.
// chat_input 셀(6/7/9)도 동일 — 입력 → claim insert 가 같이 일어남.
// ─────────────────────────────────────────────────────────
export async function checkAllCells(
  agentName: string,
): Promise<Record<CellId, CellStatus>> {
  const db = getDb();
  const claims = await db
    .select({ cellId: bingoClaims.cellId })
    .from(bingoClaims)
    .where(eq(bingoClaims.agentName, agentName));
  const claimed = new Set(claims.map((c) => c.cellId as CellId));

  const result = {} as Record<CellId, CellStatus>;
  for (const cell of [1, 2, 3, 4, 5, 6, 7, 8, 9] as CellId[]) {
    result[cell] = claimed.has(cell) ? 'done' : 'pending';
  }
  return result;
}

/** 자동 검증 통과 시 호출 — 한 번만 insert, 중복은 무시. */
export async function recordBingoClaim(
  agentName: string,
  cell: CellId,
  reason?: string,
): Promise<void> {
  const db = getDb();
  try {
    await db
      .insert(bingoClaims)
      .values({ agentName, cellId: cell, reason: reason ?? null })
      .onConflictDoNothing();
  } catch (err) {
    log.warn(`bingo claim insert failed agent=${agentName} cell=${cell}`, err);
  }
}

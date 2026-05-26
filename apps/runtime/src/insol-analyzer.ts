import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { eq, sql, and, desc } from 'drizzle-orm';
import {
  getDb,
  agents,
  runs,
  toolCalls,
  llmCalls,
  telegramMessages,
  slackMentions,
  kvState,
} from '@rego/db';
import { getAgentsRoot } from './agent-registry.js';
import { createLogger } from './logger.js';
import { CELL_DEFS, CELL_IDS, type CellId } from './bingo-rules.js';
import { checkAllCells } from './bingo-checks.js';

const log = createLogger('insol-analyzer');

// ─────────────────────────────────────────────────────────
// 학습자 코드 분석
// ─────────────────────────────────────────────────────────

export interface LearnerCode {
  agent: string;
  handlerPath: string;
  handlerExists: boolean;
  handlerSnippet?: string;
  handlerLines: number;
  triggers: string[]; // trigger types from agent.config.ts (parsed loosely)
  usedTools: string[]; // tool ids referenced in handler.ts
}

/**
 * 학습자의 handler.ts + agent.config.ts를 읽어 핵심 정보 추출.
 * LLM에 던질 컨텍스트 + 시각화 데이터로 사용.
 */
export async function loadLearnerCode(agent: string): Promise<LearnerCode> {
  const root = getAgentsRoot();
  const folder = path.join(root, agent);
  const handlerPath = path.join(folder, 'handler.ts');
  const configPath = path.join(folder, 'agent.config.ts');

  if (!existsSync(handlerPath)) {
    return {
      agent,
      handlerPath,
      handlerExists: false,
      handlerLines: 0,
      triggers: [],
      usedTools: [],
    };
  }

  const handlerSnippet = await fs.readFile(handlerPath, 'utf8');
  const lines = handlerSnippet.split('\n').length;

  // 도구 호출 패턴 추출 — ctx.tools['slack.X'] / ctx.tools.slack.X
  const toolMatches = handlerSnippet.matchAll(
    /ctx\.tools\[['"`]([^'"`]+)['"`]\]|ctx\.tools\.([\w.]+)/g,
  );
  const usedTools = new Set<string>();
  for (const m of toolMatches) {
    const id = (m[1] || m[2] || '').replace(/['"`]/g, '');
    if (id && id.includes('.')) usedTools.add(id);
  }

  // 트리거 추출 (config 파일에서)
  const triggers: string[] = [];
  if (existsSync(configPath)) {
    const config = await fs.readFile(configPath, 'utf8');
    const triggerMatches = config.matchAll(/trigger\.(\w+)\s*\(/g);
    for (const m of triggerMatches) if (m[1]) triggers.push(m[1]);
  }

  return {
    agent,
    handlerPath,
    handlerExists: true,
    handlerSnippet,
    handlerLines: lines,
    triggers,
    usedTools: Array.from(usedTools).sort(),
  };
}

// ─────────────────────────────────────────────────────────
// 학습자 활동 통계 (리빌 + 2주차 대시보드)
// ─────────────────────────────────────────────────────────

export interface LearnerStats {
  agent: string;
  runs: { total: number; success: number; failed: number };
  toolCalls: {
    total: number;
    byTool: Record<string, number>;
    topTools: Array<{ id: string; count: number }>;
  };
  llmCalls: { total: number; totalCostUsd: number };
  telegramSent: number;
  mentionsReceived: number;
  bingoDone: number;
  lastActivityAt: string | null;
}

export async function loadLearnerStats(agent: string): Promise<LearnerStats> {
  const db = getDb();

  const [runStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      success: sql<number>`count(*) filter (where status='success')::int`,
      failed: sql<number>`count(*) filter (where status in ('failed','timeout'))::int`,
    })
    .from(runs)
    .where(eq(runs.agentName, agent));

  const toolRows = await db
    .select({ toolId: toolCalls.toolId, count: sql<number>`count(*)::int` })
    .from(toolCalls)
    .where(and(eq(toolCalls.agentName, agent), sql`${toolCalls.error} IS NULL`))
    .groupBy(toolCalls.toolId);

  const byTool: Record<string, number> = {};
  let toolTotal = 0;
  for (const r of toolRows) {
    byTool[r.toolId] = r.count;
    toolTotal += r.count;
  }
  const topTools = toolRows
    .map((r) => ({ id: r.toolId, count: r.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const [llm] = await db
    .select({
      total: sql<number>`count(*)::int`,
      cost: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)::text`,
    })
    .from(llmCalls)
    .where(eq(llmCalls.agentName, agent));

  const [tg] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(telegramMessages)
    .where(eq(telegramMessages.agentName, agent));

  const [mention] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(slackMentions)
    .where(eq(slackMentions.user, sql`(SELECT slack_user_id FROM agents WHERE name = ${agent})`));

  const cells = await checkAllCells(agent);
  const bingoDone = Object.values(cells).filter((s) => s === 'done').length;

  const [lastRun] = await db
    .select({ startedAt: sql<string>`max(${runs.startedAt})::text` })
    .from(runs)
    .where(eq(runs.agentName, agent));

  return {
    agent,
    runs: {
      total: runStats?.total ?? 0,
      success: runStats?.success ?? 0,
      failed: runStats?.failed ?? 0,
    },
    toolCalls: { total: toolTotal, byTool, topTools },
    llmCalls: { total: llm?.total ?? 0, totalCostUsd: parseFloat(llm?.cost ?? '0') },
    telegramSent: tg?.cnt ?? 0,
    mentionsReceived: mention?.cnt ?? 0,
    bingoDone,
    lastActivityAt: lastRun?.startedAt ?? null,
  };
}

// ─────────────────────────────────────────────────────────
// 셀별 코칭 — 학습자 코드 vs 셀 요구사항 비교 → 다음 한 줄 안내
// ─────────────────────────────────────────────────────────

export interface CellGuidance {
  cell: CellId;
  title: string;
  description: string;
  hint: string;
  /** 학습자가 아직 안 한 작업 한 줄 */
  nextStep: string;
  /** 복붙 가능한 코드 스니펫 (없을 수 있음) */
  snippet?: string;
}

const SNIPPETS: Partial<Record<CellId, string>> = {
  3: `// onSlackMention 맨 위에 추가:
await ctx.tools['slack.reactions_add']!({
  channel: event.channel,
  ts: event.ts,
  name: 'eyes',
});`,
  5: `// 분류 직후, lines 작성 전에:
const userInfo = await ctx.tools['slack.users_info']!({ user: event.user });
const channelInfo = await ctx.tools['slack.conversations_info']!({ channel: event.channel });
const senderName = userInfo.display_name || userInfo.real_name || event.user;
const channelLabel = channelInfo.name || event.channel;
// lines의 from/ch 줄을 senderName / channelLabel로 교체`,
  4: `// telegram.send에 replyMarkup 추가:
await ctx.tools['telegram.send']!({
  text: lines.join('\\n'),
  parseMode: 'Markdown',
  replyMarkup: {
    inline_keyboard: [[
      { text: '✅ 확인', callback_data: \`ack:\${event.ts}\` },
      { text: '⏭ 패스', callback_data: \`pass:\${event.ts}\` },
    ]],
  },
});

// defineHandler 안에 onTelegramCallback 추가:
async onTelegramCallback(event, ctx) {
  const [action, slackTs] = event.data.split(':');
  await ctx.tools['telegram.edit_message']!({
    chatId: event.chatId,
    messageId: event.messageId,
    text: action === 'ack' ? \`✅ 확인 완료\` : \`⏭ 패스됨\`,
  });
  return { action };
},`,
  8: `// agent.config.ts triggers에 추가:
trigger.cron('0 9 * * *'),   // 매일 아침 9시 (Asia/Seoul)

// handler.ts defineHandler 안에 onCron 추가:
async onCron(event, ctx) {
  await ctx.tools['telegram.send']!({
    text: '☀️ 좋은 아침! 어제 슬랙 활동 요약 곧 보내드릴게요.',
  });
  return { ok: true };
},`,
};

export async function buildCellGuidance(cell: CellId, agent: string): Promise<CellGuidance> {
  const def = CELL_DEFS[cell];
  let nextStep = def.description;

  if (cell === 3 || cell === 4 || cell === 5 || cell === 8) {
    // 학습자 코드 보고 이미 했는지 점검
    const code = await loadLearnerCode(agent);
    if (cell === 3 && code.usedTools.includes('slack.reactions_add')) {
      nextStep = '이미 코드에 추가했어요! 슬랙에서 본인 멘션 보내서 동작 확인.';
    } else if (cell === 5 && (code.usedTools.includes('slack.users_info') || code.usedTools.includes('slack.conversations_info'))) {
      nextStep = '도구 호출은 추가했네요! 결과를 텔레그램 메시지에 박았는지 확인하세요.';
    } else if (cell === 8 && code.triggers.includes('cron')) {
      nextStep = 'cron 트리거 등록됐어요! 발화 시각 기다리거나 onCron이 잘 정의됐는지 확인.';
    }
  }

  return {
    cell,
    title: def.title,
    description: def.description,
    hint: def.hint,
    nextStep,
    snippet: SNIPPETS[cell],
  };
}

// ─────────────────────────────────────────────────────────
// 운영자 메타 질의 응답용 데이터
// ─────────────────────────────────────────────────────────

export interface OperatorOverview {
  total: number;
  done: number; // 빙고 9 완주
  active: number; // 최근 5분 활동
  stuck: number; // 5분+ 정체
  stuckAgents: Array<{ name: string; cellsDone: number; minsSinceActivity: number | null }>;
  topPerformers: Array<{ name: string; cellsDone: number }>;
  toolPopularity: Array<{ id: string; calls: number }>;
}

export async function buildOperatorOverview(): Promise<OperatorOverview> {
  const db = getDb();

  const all = await db.select({ name: agents.name }).from(agents);

  const lastRuns = await db
    .select({
      agentName: runs.agentName,
      lastAt: sql<string>`max(${runs.startedAt})::text`,
    })
    .from(runs)
    .groupBy(runs.agentName);
  const lastMap = new Map(lastRuns.map((r) => [r.agentName, r.lastAt]));

  const perAgent = await Promise.all(
    all.map(async (a) => {
      const cells = await checkAllCells(a.name);
      const done = Object.values(cells).filter((s) => s === 'done').length;
      const lastAt = lastMap.get(a.name);
      const mins = lastAt
        ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 60_000)
        : null;
      return {
        name: a.name,
        cellsDone: done,
        minsSinceActivity: mins,
        stuck: mins !== null && mins > 5 && done > 0 && done < 9,
        active: mins !== null && mins < 5,
        finished: done === 9,
      };
    }),
  );

  const tools = await db
    .select({ id: toolCalls.toolId, calls: sql<number>`count(*)::int` })
    .from(toolCalls)
    .where(sql`${toolCalls.error} IS NULL`)
    .groupBy(toolCalls.toolId);

  return {
    total: perAgent.length,
    done: perAgent.filter((a) => a.finished).length,
    active: perAgent.filter((a) => a.active).length,
    stuck: perAgent.filter((a) => a.stuck).length,
    stuckAgents: perAgent
      .filter((a) => a.stuck)
      .map((a) => ({
        name: a.name,
        cellsDone: a.cellsDone,
        minsSinceActivity: a.minsSinceActivity,
      })),
    topPerformers: perAgent
      .sort((a, b) => b.cellsDone - a.cellsDone)
      .slice(0, 5)
      .map((a) => ({ name: a.name, cellsDone: a.cellsDone })),
    toolPopularity: tools.sort((a, b) => b.calls - a.calls).slice(0, 8),
  };
}

// ─────────────────────────────────────────────────────────
// PAT 큐 (학습자 제출 → 운영자가 처리)
// ─────────────────────────────────────────────────────────

const PAT_KEY = 'pat_pending';

export async function submitPat(agent: string, token: string): Promise<void> {
  const db = getDb();
  await db
    .insert(kvState)
    .values({
      agentName: agent,
      key: PAT_KEY,
      value: { token, submittedAt: new Date().toISOString() },
    })
    .onConflictDoUpdate({
      target: [kvState.agentName, kvState.key],
      set: { value: { token, submittedAt: new Date().toISOString() }, updatedAt: new Date() },
    });
  log.info(`PAT submitted by ${agent}`);
}

export async function listPendingPats(): Promise<Array<{ agent: string; submittedAt: string }>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(kvState)
    .where(eq(kvState.key, PAT_KEY));
  return rows
    .map((r) => ({
      agent: r.agentName,
      submittedAt: (r.value as { submittedAt?: string } | null)?.submittedAt ?? '',
    }))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

// ─────────────────────────────────────────────────────────
// 학습자 청사진 (Stage 3 리빌 + Stage 4 갤러리)
// ─────────────────────────────────────────────────────────

export interface AgentBlueprint {
  agent: string;
  displayName: string | null;
  triggers: string[];
  tools: string[];
  hasOnCron: boolean;
  hasOnTelegramCallback: boolean;
  handlerLines: number;
  stats: {
    runs: number;
    toolCalls: number;
    telegramSent: number;
    llmCost: number;
  };
}

export async function buildBlueprint(agent: string): Promise<AgentBlueprint> {
  const db = getDb();
  const [a] = await db
    .select({ displayName: agents.displayName })
    .from(agents)
    .where(eq(agents.name, agent));

  const code = await loadLearnerCode(agent);
  const stats = await loadLearnerStats(agent);

  return {
    agent,
    displayName: a?.displayName ?? null,
    triggers: code.triggers,
    tools: code.usedTools,
    hasOnCron: code.handlerSnippet?.includes('onCron') ?? false,
    hasOnTelegramCallback: code.handlerSnippet?.includes('onTelegramCallback') ?? false,
    handlerLines: code.handlerLines,
    stats: {
      runs: stats.runs.total,
      toolCalls: stats.toolCalls.total,
      telegramSent: stats.telegramSent,
      llmCost: stats.llmCalls.totalCostUsd,
    },
  };
}

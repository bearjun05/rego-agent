import { randomUUID } from 'node:crypto';
import { eq, and, sql as drizzleSql } from 'drizzle-orm';
import {
  getDb,
  runs,
  llmCalls,
  toolCalls,
  agents,
  kvState,
  telegramMessages,
} from '@rego/db';
import type {
  AgentContext,
  AgentEvent,
  AgentLogger,
  LLMApi,
  ToolDefinition,
  ToolContext,
} from '@rego/runtime-sdk';
import { allCommonTools } from '@rego/tools';
import { createLlmApi } from '@rego/tools/llm';
import { env } from './env.js';
import { createLogger } from './logger.js';
import { getEventBus } from './event-bus.js';
import { audit } from './audit.js';
import { incrementCalls } from './rate-limit.js';
import { getAgent, listAgents, type LoadedAgent } from './agent-registry.js';

// ─────────────────────────────────────────────────────────
// Tool registry (공통 + per-agent custom)
// ─────────────────────────────────────────────────────────
function getAllToolsForAgent(agent: LoadedAgent): Map<string, ToolDefinition> {
  const m = new Map<string, ToolDefinition>();
  for (const t of allCommonTools) m.set(t.id, t);
  for (const [id, t] of Object.entries(agent.customTools)) {
    m.set(id, t as ToolDefinition);
  }
  return m;
}

// ─────────────────────────────────────────────────────────
// Event routing — 어느 에이전트가 이 이벤트를 받아야 하나
// ─────────────────────────────────────────────────────────
export function matchAgentsForEvent(event: AgentEvent, ownMentionsOnly = true): LoadedAgent[] {
  const all = listAgents();
  const matched: LoadedAgent[] = [];

  for (const agent of all) {
    for (const t of agent.manifest.triggers) {
      if (t.type !== event.type) continue;

      // 채널 필터
      if (
        (event.type === 'slack.mention' || event.type === 'slack.message') &&
        t.channel
      ) {
        const eventChannel = (event as { channelName?: string; channel?: string }).channelName ??
          (event as { channel?: string }).channel;
        if (t.channel !== '*' && eventChannel !== t.channel) continue;
      }

      // 이모지 필터
      if (event.type === 'slack.reaction_added' && t.emoji) {
        if (t.emoji !== event.emoji) continue;
      }

      // slack.mention 의 경우 — 본인 이름 포함 검사
      if (event.type === 'slack.mention' && ownMentionsOnly) {
        const text = event.text ?? '';
        const nameLower = agent.name.toLowerCase();
        const displayLower = (agent.manifest.displayName ?? '').toLowerCase();
        const txtLower = text.toLowerCase();
        // @uj_choe / @uj-choe 또는 한글 이름까지 폭넓게
        const isMatch =
          txtLower.includes(`@${nameLower}`) ||
          txtLower.includes(`@${nameLower.replace(/\./g, '')}`) ||
          (displayLower && txtLower.includes(`@${displayLower}`));
        if (!isMatch) continue;
      }

      matched.push(agent);
      break;
    }
  }
  return matched;
}

// ─────────────────────────────────────────────────────────
// Context 생성
// ─────────────────────────────────────────────────────────
async function createContext(agent: LoadedAgent, runId: string): Promise<AgentContext> {
  const cfg = env();
  const logger = createLogger(`agent:${agent.name}`);
  const tools = getAllToolsForAgent(agent);

  // 사람의 chat_id 조회 (telegram.send 자동 주입용)
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.name, agent.name));
  const chatId = row?.telegramChatId;

  // 카운터
  let llmCallCount = 0;
  let toolCallCount = 0;

  // LLM API
  const llmApi: LLMApi = createLlmApi({
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    agentName: agent.name,
    runId,
    defaultGenerateModel: cfg.MODEL_GENERATE,
    defaultClassifyModel: cfg.MODEL_CLASSIFY,
    async onCallComplete(info) {
      llmCallCount += 1;
      try {
        await db.insert(llmCalls).values({
          runId,
          agentName: agent.name,
          model: info.model,
          purpose: info.purpose,
          inputTokens: info.inputTokens,
          outputTokens: info.outputTokens,
          costUsd: info.costUsd.toFixed(6),
          durationMs: info.durationMs,
          promptPreview: info.promptPreview,
          responsePreview: info.responsePreview,
        });
        await incrementCalls(agent.name, 'llm');
        await getEventBus().publish({
          type: 'llm.called',
          agentName: agent.name,
          payload: { model: info.model, costUsd: info.costUsd, runId },
        });
      } catch (err) {
        logger.error('Failed to record llm call', err);
      }
    },
    async onError(info) {
      try {
        await db.insert(llmCalls).values({
          runId,
          agentName: agent.name,
          model: info.model,
          error: info.error,
          costUsd: '0',
        });
      } catch {}
    },
  });

  // tools proxy
  const toolsProxy: Record<string, (input: unknown) => Promise<unknown>> = {};
  // manifest에 선언된 + 사용자 폴더 custom 도구 + 안전망(공통 도구 다 노출, manifest sync가 백업 안전망)
  const accessibleTools = new Set<string>([
    ...(agent.manifest.tools ?? []),
    ...Object.keys(agent.customTools),
    // 공통 도구는 다 사용 가능 — manifest auto-sync로 보강됨
    ...allCommonTools.map((t) => t.id),
  ]);

  for (const [id, tool] of tools) {
    if (!accessibleTools.has(id)) continue;

    const toolCtx: ToolContext & { agentChatId?: string } = {
      agentName: agent.name,
      runId,
      logger,
      secret: (key: string) => {
        // tool이 선언한 secret만 허용
        if (tool.secrets && !tool.secrets.includes(key)) {
          throw new Error(`Tool ${id} did not declare secret ${key}`);
        }
        const value = process.env[key];
        if (!value) throw new Error(`Secret ${key} not set`);
        return value;
      },
      agentChatId: chatId ?? undefined,
    };

    toolsProxy[id] = async (input: unknown) => {
      const start = Date.now();
      toolCallCount += 1;
      if (toolCallCount > cfg.RUN_MAX_TOOL_CALLS) {
        throw new Error(`Tool call limit exceeded (${cfg.RUN_MAX_TOOL_CALLS})`);
      }

      // input validation
      const parsed = tool.inputs.safeParse(input);
      if (!parsed.success) {
        const errMsg = `Tool ${id} invalid input: ${parsed.error.message}`;
        await db.insert(toolCalls).values({
          runId,
          agentName: agent.name,
          toolId: id,
          input,
          error: errMsg,
          durationMs: Date.now() - start,
        });
        throw new Error(errMsg);
      }

      try {
        const output = await tool.run(parsed.data, toolCtx);

        // 슬랙 멘션 매핑 추적: telegram.send 시 매핑 저장 (런타임이 별도 처리)
        await db.insert(toolCalls).values({
          runId,
          agentName: agent.name,
          toolId: id,
          input: parsed.data,
          output,
          durationMs: Date.now() - start,
        });

        await incrementCalls(agent.name, 'tool');
        await getEventBus().publish({
          type: 'tool.called',
          agentName: agent.name,
          payload: { toolId: id, runId, durationMs: Date.now() - start },
        });
        return output;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await db.insert(toolCalls).values({
          runId,
          agentName: agent.name,
          toolId: id,
          input: parsed.data,
          error: errMsg,
          durationMs: Date.now() - start,
        });
        throw err;
      }
    };
  }

  const ctx: AgentContext = {
    agentName: agent.name,
    runId,
    logger,
    llm: wrapLlmWithLimit(llmApi, () => llmCallCount, cfg.RUN_MAX_LLM_CALLS),
    tools: toolsProxy,
    state: createKvState(agent.name),
    peers: {
      async list() {
        return listAgents().map((a) => a.name);
      },
      async getManifest(name: string) {
        return getAgent(name)?.manifest ?? null;
      },
    },
  };

  return ctx;
}

function wrapLlmWithLimit(llm: LLMApi, getCount: () => number, max: number): LLMApi {
  const check = () => {
    if (getCount() >= max) throw new Error(`LLM call limit exceeded (${max})`);
  };
  return {
    async generate(p, o) {
      check();
      return llm.generate(p, o);
    },
    async classify(o) {
      check();
      return llm.classify(o);
    },
    async generateJson(p, s, o) {
      check();
      return llm.generateJson(p, s, o);
    },
  };
}

function createKvState(agentName: string) {
  const db = getDb();
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const [row] = await db
        .select()
        .from(kvState)
        .where(and(eq(kvState.agentName, agentName), eq(kvState.key, key)));
      return (row?.value as T) ?? null;
    },
    async set(key: string, value: unknown) {
      await db
        .insert(kvState)
        .values({ agentName, key, value })
        .onConflictDoUpdate({
          target: [kvState.agentName, kvState.key],
          set: { value, updatedAt: new Date() },
        });
    },
    async delete(key: string) {
      await db
        .delete(kvState)
        .where(and(eq(kvState.agentName, agentName), eq(kvState.key, key)));
    },
  };
}

// ─────────────────────────────────────────────────────────
// 핸들러 라우팅
// ─────────────────────────────────────────────────────────
function pickHandler(agent: LoadedAgent, event: AgentEvent) {
  const h = agent.handlers;
  if (event.type === 'slack.mention' && h.onSlackMention) return h.onSlackMention;
  if (event.type === 'slack.message' && h.onSlackMessage) return h.onSlackMessage;
  if (event.type === 'slack.reaction_added' && h.onSlackReaction) return h.onSlackReaction;
  if (event.type === 'cron' && h.onCron) return h.onCron;
  if (event.type === 'manual' && h.onManual) return h.onManual;
  return h.default;
}

// ─────────────────────────────────────────────────────────
// Main run
// ─────────────────────────────────────────────────────────
export interface RunOptions {
  /** Slack 멘션 매핑 추적용 (대시보드 핵심 뷰 source) */
  sourceSlackMentionId?: number;
  /** smoke test 등 시뮬레이션 표시 */
  triggeredBy?: 'real' | 'smoke' | 'cross-smoke';
  /** smoke fixture id (있으면 smoke_runs에 기록) */
  fixtureId?: string;
  fixtureOwner?: string;
  fixtureScope?: string;
  triggeredFromAgent?: string;
}

export interface RunResult {
  runId: string;
  agentName: string;
  status: 'success' | 'failed' | 'timeout' | 'aborted';
  durationMs: number;
  costUsd: number;
  result?: unknown;
  error?: string;
}

export async function runAgentForEvent(
  agent: LoadedAgent,
  event: AgentEvent,
  options: RunOptions = {},
): Promise<RunResult> {
  const cfg = env();
  const runId = randomUUID();
  const startedAt = new Date();
  const db = getDb();
  const log = createLogger(`run:${runId.slice(0, 6)}`);
  const bus = getEventBus();

  // pause 검사
  const [row] = await db.select().from(agents).where(eq(agents.name, agent.name));
  if (row?.isPaused) {
    log.warn(`Agent ${agent.name} is paused: ${row.pausedReason}`);
    return {
      runId,
      agentName: agent.name,
      status: 'aborted',
      durationMs: 0,
      costUsd: 0,
      error: `agent paused: ${row.pausedReason}`,
    };
  }

  // run 레코드 생성
  await db.insert(runs).values({
    id: runId,
    agentName: agent.name,
    triggerType: event.type,
    triggerPayload: event,
    status: 'running',
    startedAt,
  });

  await bus.publish({
    type: 'run.started',
    agentName: agent.name,
    payload: { runId, triggerType: event.type, triggeredBy: options.triggeredBy ?? 'real' },
  });

  const handler = pickHandler(agent, event);
  if (!handler) {
    const error = `No handler for event type ${event.type}`;
    await db
      .update(runs)
      .set({ status: 'failed', error, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() })
      .where(eq(runs.id, runId));
    return {
      runId,
      agentName: agent.name,
      status: 'failed',
      durationMs: 0,
      costUsd: 0,
      error,
    };
  }

  // ctx 생성
  const ctx = await createContext(agent, runId);

  // timeout 처리
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      timedOut = true;
      reject(new Error(`Timeout after ${cfg.RUN_TIMEOUT_MS}ms`));
    }, cfg.RUN_TIMEOUT_MS),
  );

  let status: RunResult['status'] = 'success';
  let result: unknown;
  let error: string | undefined;
  let costUsd = 0;

  try {
    // handler 시그니처는 특정 event 타입을 받지만 여기선 union이라 cast
    const fn = handler as (e: AgentEvent, c: typeof ctx) => Promise<unknown>;
    result = await Promise.race([fn(event, ctx), timeoutPromise]);
    status = 'success';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    status = timedOut ? 'timeout' : 'failed';
    log.error('Run failed', err);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  // 비용 집계
  const costRows = await db
    .select({ total: drizzleSql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)::text` })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId));
  costUsd = parseFloat(costRows[0]?.total ?? '0');

  await db
    .update(runs)
    .set({
      status,
      finishedAt,
      durationMs,
      costUsd: costUsd.toFixed(6),
      result: result ?? null,
      error: error ?? null,
    })
    .where(eq(runs.id, runId));

  // 텔레그램 전송 추적: tool_calls 중 telegram.send 가 있으면 매핑 기록
  if (options.sourceSlackMentionId !== undefined) {
    const sentMessages = await db
      .select()
      .from(toolCalls)
      .where(and(eq(toolCalls.runId, runId), eq(toolCalls.toolId, 'telegram.send')));
    for (const tc of sentMessages) {
      const out = tc.output as { messageId?: number } | null;
      const input = tc.input as { text?: string; chatId?: string } | null;
      if (input?.text) {
        await db.insert(telegramMessages).values({
          runId,
          agentName: agent.name,
          chatId: input.chatId ?? (row?.telegramChatId ?? ''),
          text: input.text,
          payload: tc.input ?? null,
          telegramMessageId: out?.messageId?.toString() ?? null,
          triggeredBySlackMentionId: options.sourceSlackMentionId,
        });
      }
    }
  }

  await bus.publish({
    type: 'run.finished',
    agentName: agent.name,
    payload: { runId, status, durationMs, costUsd },
  });

  return { runId, agentName: agent.name, status, durationMs, costUsd, result, error };
}

export async function runAgentByName(
  agentName: string,
  event: AgentEvent,
  options: RunOptions = {},
): Promise<RunResult> {
  const agent = getAgent(agentName);
  if (!agent) {
    throw new Error(`Agent ${agentName} not loaded`);
  }
  return runAgentForEvent(agent, event, options);
}

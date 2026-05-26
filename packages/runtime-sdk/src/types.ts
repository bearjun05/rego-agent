import { z } from 'zod';

// ─────────────────────────────────────────────────────────
// Trigger
// ─────────────────────────────────────────────────────────

export const TriggerTypeSchema = z.enum([
  'slack.mention',
  'slack.message',
  'slack.reaction_added',
  'cron',
  'http',
  'manual',
]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const TriggerDefSchema = z.object({
  type: TriggerTypeSchema,
  channel: z.string().optional(),
  emoji: z.string().optional(),
  schedule: z.string().optional(),
  path: z.string().optional(),
});
export type TriggerDef = z.infer<typeof TriggerDefSchema>;

// ─────────────────────────────────────────────────────────
// Agent manifest
// ─────────────────────────────────────────────────────────

export const AgentManifestSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string(),
  version: z.string().default('0.1.0'),
  icon: z.string().default('🤖'),
  color: z.string().default('#000000'),
  githubHandle: z.string().optional(),

  triggers: z.array(TriggerDefSchema),

  // 도구는 선언하되, 코드와 불일치 시 자동 동기화 (manifest:sync)
  tools: z.array(z.string()).default([]),

  // 모델 tier (선택, 미선언 시 기본값)
  models: z
    .object({
      classify: z.string().optional(),
      generate: z.string().optional(),
      chat: z.string().optional(),
    })
    .optional(),

  // 한도 (선택)
  limits: z
    .object({
      timeoutMs: z.number().int().positive().optional(),
      maxLlmCalls: z.number().int().positive().optional(),
      maxToolCalls: z.number().int().positive().optional(),
    })
    .optional(),

  // 메타
  meta: z.record(z.unknown()).optional(),
});
export type AgentManifest = z.infer<typeof AgentManifestSchema>;
/** 사용자가 defineAgent에 전달하는 입력 타입 (default 필드는 optional) */
export type AgentManifestInput = z.input<typeof AgentManifestSchema>;

// ─────────────────────────────────────────────────────────
// Tool definition (self-describing)
// ─────────────────────────────────────────────────────────

export type ToolCostTier = 'free' | 'low' | 'medium' | 'high';
export type ToolCategory =
  | 'event'
  | 'messaging'
  | 'knowledge'
  | 'llm'
  | 'utility'
  | 'custom';

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon?: string;
  color?: string;

  /** 입력/출력 Zod 스키마 (런타임 검증 + 자동 시각화) */
  inputs: z.ZodType<TInput>;
  outputs: z.ZodType<TOutput>;

  /** 시각화/UX용 메타 */
  costTier?: ToolCostTier;
  latencyTier?: 'fast' | 'medium' | 'slow';
  sideEffects?: {
    reads?: string[];
    writes?: string[];
  };

  /** 호출 시 주입할 env 키 (런타임이 체크) */
  secrets?: string[];

  /** 실제 동작 */
  run: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

// ─────────────────────────────────────────────────────────
// Context — handler/tool 안에서 사용하는 런타임 컨텍스트
// ─────────────────────────────────────────────────────────

export interface AgentLogger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

export interface LLMCallOptions {
  model?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  purpose?: string;
  responseFormat?: 'text' | 'json';
}

export interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
  durationMs: number;
}

export interface ClassifyOptions {
  text: string;
  categories: string[] | Array<{ id: string; description: string }>;
  prompt?: string;
  model?: string;
}

export interface LLMApi {
  /** 자유형 텍스트 생성 */
  generate: (prompt: string, opts?: LLMCallOptions) => Promise<LLMResult>;
  /** 카테고리 분류 (구조화된 결과) */
  classify: (opts: ClassifyOptions) => Promise<{ category: string; confidence: number; reason?: string }>;
  /** JSON 모드 */
  generateJson: <T = unknown>(prompt: string, schema: z.ZodType<T>, opts?: LLMCallOptions) => Promise<T>;
}

export interface AgentContext {
  agentName: string;
  runId: string;
  logger: AgentLogger;
  llm: LLMApi;
  /** 선언된 도구만 노출 (선언 안 한 도구는 undefined) */
  tools: Record<string, (input: unknown) => Promise<unknown>>;
  /** 본인 namespace KV 스토리지 (영구) */
  state: {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  /** 다른 사람 agent 정보 (read-only) */
  peers: {
    list: () => Promise<string[]>;
    getManifest: (name: string) => Promise<AgentManifest | null>;
  };
}

export interface ToolContext extends Pick<AgentContext, 'agentName' | 'runId' | 'logger'> {
  /** env에서 시크릿 가져오기 (런타임이 권한 체크) */
  secret: (key: string) => string;
  /** 텔레그램 chat_id (telegram.send 자동 주입용). 미설정 시 도구가 throw. */
  agentChatId?: string;
  /** 소유자 슬랙 OAuth 토큰 (slack.* 도구 자동 사용). 미설정 시 SLACK_NOT_CONNECTED throw. */
  agentSlackToken?: string;
}

// ─────────────────────────────────────────────────────────
// Events (handler 인자)
// ─────────────────────────────────────────────────────────

export interface SlackMentionEvent {
  type: 'slack.mention';
  text: string;
  channel: string;
  channelName?: string;
  user: string;
  userName?: string;
  ts: string;
  threadTs?: string;
  permalink?: string;
  raw: unknown;
}

export interface SlackMessageEvent {
  type: 'slack.message';
  text: string;
  channel: string;
  channelName?: string;
  user: string;
  userName?: string;
  ts: string;
  threadTs?: string;
  raw: unknown;
}

export interface SlackReactionEvent {
  type: 'slack.reaction_added';
  emoji: string;
  user: string;
  userName?: string;
  item: {
    channel: string;
    ts: string;
  };
  raw: unknown;
}

export interface CronEvent {
  type: 'cron';
  schedule: string;
  firedAt: string;
}

export interface ManualEvent {
  type: 'manual';
  payload: unknown;
}

export interface TelegramCallbackEvent {
  type: 'telegram.callback';
  callbackQueryId: string;
  /** 버튼에 박은 callback_data (최대 64바이트). 예: "approve:123" */
  data: string;
  chatId: string;
  messageId: number;
  /** 콜백을 누른 텔레그램 사용자 ID */
  userId: string;
  userName?: string;
  /** 원본 메시지 텍스트 (수정 도구 사용 시 참고) */
  messageText?: string;
}

export type AgentEvent =
  | SlackMentionEvent
  | SlackMessageEvent
  | SlackReactionEvent
  | CronEvent
  | ManualEvent
  | TelegramCallbackEvent;

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────

export type HandlerFunction<E extends AgentEvent = AgentEvent> = (
  event: E,
  ctx: AgentContext,
) => Promise<unknown>;

export interface AgentHandlerExports {
  onSlackMention?: HandlerFunction<SlackMentionEvent>;
  onSlackMessage?: HandlerFunction<SlackMessageEvent>;
  onSlackReaction?: HandlerFunction<SlackReactionEvent>;
  onCron?: HandlerFunction<CronEvent>;
  onManual?: HandlerFunction<ManualEvent>;
  /** 텔레그램 버튼 클릭 콜백 (manifest 트리거 아님 — chat_id 매핑으로 라우팅) */
  onTelegramCallback?: HandlerFunction<TelegramCallbackEvent>;
  /** Generic catch-all */
  default?: HandlerFunction<AgentEvent>;
}

// ─────────────────────────────────────────────────────────
// Run / Audit / Event records
// ─────────────────────────────────────────────────────────

export type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'aborted';

export interface RunRecord {
  id: string;
  agentName: string;
  triggerType: TriggerType;
  status: RunStatus;
  costUsd: number;
  durationMs: number;
  startedAt: Date;
  finishedAt?: Date;
  result?: unknown;
  error?: string;
}

import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  bigserial,
  jsonb,
  boolean,
  numeric,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────
// agents — 등록된 에이전트 (사람당 1개)
// ─────────────────────────────────────────────────────────
export const agents = pgTable(
  'agents',
  {
    name: text('name').primaryKey(), // "uj.choe"
    displayName: text('display_name'),
    githubHandle: text('github_handle'),
    telegramChatId: text('telegram_chat_id'),
    telegramUsername: text('telegram_username'),
    slackUserId: text('slack_user_id'), // 슬랙 멘션 라우팅: <@U…> → 이 에이전트
    icon: text('icon').default('🤖'),
    color: text('color').default('#000000'),
    description: text('description'),

    // 최신 manifest (push 때 자동 sync)
    currentManifest: jsonb('current_manifest').$type<unknown>(),
    currentCommit: text('current_commit'),
    currentVersion: text('current_version'),

    // 상태
    isPaused: boolean('is_paused').notNull().default(false),
    pausedReason: text('paused_reason'),

    // AI 코드 분석 결과 (push마다 갱신) — 대시보드 프로필 표시용
    analysisSummary: text('analysis_summary'), // 비개발자용 1-2문장 요약
    capabilities: jsonb('capabilities').$type<string[]>(), // 기능 리스트
    techniques: jsonb('techniques').$type<string[]>(), // 사용 기법 (분류/요약/버튼 등)
    analyzedCommit: text('analyzed_commit'),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    githubIdx: index('agents_github_idx').on(t.githubHandle),
    telegramIdx: index('agents_telegram_idx').on(t.telegramChatId),
  }),
);

// ─────────────────────────────────────────────────────────
// telegram_pending_registrations — 셋업 마법사 polling용
// ─────────────────────────────────────────────────────────
export const telegramPending = pgTable(
  'telegram_pending',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentName: text('agent_name').notNull(), // 사용자가 /start로 보낸 이름
    chatId: text('chat_id').notNull(),
    username: text('username'),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index('telegram_pending_name_idx').on(t.agentName),
  }),
);

// ─────────────────────────────────────────────────────────
// events — 모든 이벤트의 영구 로그 (event sourcing)
// ─────────────────────────────────────────────────────────
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventType: text('event_type').notNull(),
    agentName: text('agent_name'),
    payload: jsonb('payload').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index('events_type_idx').on(t.eventType, t.createdAt),
    agentIdx: index('events_agent_idx').on(t.agentName, t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────
// runs — 핸들러 실행 단위
// ─────────────────────────────────────────────────────────
export const runs = pgTable(
  'runs',
  {
    id: text('id').primaryKey(), // uuid
    agentName: text('agent_name').notNull(),
    triggerType: text('trigger_type').notNull(),
    triggerPayload: jsonb('trigger_payload').$type<unknown>(),
    status: text('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0'),
    result: jsonb('result').$type<unknown>(),
    error: text('error'),
  },
  (t) => ({
    agentIdx: index('runs_agent_idx').on(t.agentName, t.startedAt),
    statusIdx: index('runs_status_idx').on(t.status),
  }),
);

// ─────────────────────────────────────────────────────────
// llm_calls — LLM 호출 추적 (비용 집계)
// ─────────────────────────────────────────────────────────
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id'),
    agentName: text('agent_name').notNull(),
    model: text('model').notNull(),
    purpose: text('purpose'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    durationMs: integer('duration_ms'),
    promptPreview: text('prompt_preview'),
    responsePreview: text('response_preview'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('llm_calls_run_idx').on(t.runId),
    agentIdx: index('llm_calls_agent_idx').on(t.agentName, t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────
// tool_calls — 도구 호출 추적
// ─────────────────────────────────────────────────────────
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id'),
    agentName: text('agent_name').notNull(),
    toolId: text('tool_id').notNull(),
    input: jsonb('input').$type<unknown>(),
    output: jsonb('output').$type<unknown>(),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('tool_calls_run_idx').on(t.runId),
    toolIdx: index('tool_calls_tool_idx').on(t.toolId, t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────
// slack_mentions — 받은 멘션 + 처리 결과 매핑 (1주차 핵심)
// ─────────────────────────────────────────────────────────
export const slackMentions = pgTable(
  'slack_mentions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: text('event_id'), // Slack event_id (dedup)
    teamId: text('team_id'),
    channel: text('channel'),
    channelName: text('channel_name'),
    user: text('user'),
    userName: text('user_name'),
    ts: text('ts').notNull(),
    threadTs: text('thread_ts'),
    text: text('text').notNull(),
    permalink: text('permalink'),
    raw: jsonb('raw').$type<unknown>(),
    /** 수신 경로: 'forward'(Tier1 second-brain 포워딩) | 'poll'(Tier2 유저토큰 폴링) */
    source: text('source').notNull().default('forward'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // dedup은 (channel, ts) 단일 유니크로 통일. event_id는 유니크 해제(일반 인덱스).
    // event_id 유니크 + (channel,ts) 유니크를 둘 다 두면 타깃 onConflict가 다른 인덱스
    // 충돌을 못 잡아 INSERT가 throw됨. Slack 메시지 정체성 = (channel, ts).
    eventIdx: index('slack_mentions_event_idx').on(t.eventId),
    tsIdx: index('slack_mentions_ts_idx').on(t.ts),
    channelTsUniq: uniqueIndex('slack_mentions_channel_ts_uniq').on(t.channel, t.ts),
  }),
);

// ─────────────────────────────────────────────────────────
// telegram_messages — 보낸 텔레그램 메시지 (멘션과 매핑)
// ─────────────────────────────────────────────────────────
export const telegramMessages = pgTable(
  'telegram_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id'),
    agentName: text('agent_name').notNull(),
    chatId: text('chat_id').notNull(),
    text: text('text').notNull(),
    payload: jsonb('payload').$type<unknown>(),
    telegramMessageId: text('telegram_message_id'),
    /** 멘션 → 텔레그램 매핑 (1주차 핵심 뷰의 source) */
    triggeredBySlackMentionId: bigint('triggered_by_slack_mention_id', { mode: 'number' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    error: text('error'),
  },
  (t) => ({
    agentIdx: index('telegram_msg_agent_idx').on(t.agentName, t.sentAt),
    sourceIdx: index('telegram_msg_source_idx').on(t.triggeredBySlackMentionId),
  }),
);

// ─────────────────────────────────────────────────────────
// smoke_runs — 자동/수동 스모크 테스트 결과
// ─────────────────────────────────────────────────────────
export const smokeRuns = pgTable(
  'smoke_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentName: text('agent_name').notNull(),
    fixtureId: text('fixture_id').notNull(),
    fixtureScope: text('fixture_scope').notNull().default('shared'), // shared / agent
    fixtureOwner: text('fixture_owner'), // agent가 소유한 fixture면 그 이름
    commitSha: text('commit_sha'),
    triggeredBy: text('triggered_by').notNull().default('auto'), // auto / manual / cross
    triggeredFromAgent: text('triggered_from_agent'),
    runId: text('run_id'),
    passed: boolean('passed'),
    output: jsonb('output').$type<unknown>(),
    durationMs: integer('duration_ms'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: index('smoke_agent_idx').on(t.agentName, t.createdAt),
    fixtureIdx: index('smoke_fixture_idx').on(t.fixtureId),
  }),
);

// ─────────────────────────────────────────────────────────
// fixtures — 웹에서 추가 가능한 fixture 저장소 (사용자 추가용)
// ─────────────────────────────────────────────────────────
export const fixtures = pgTable(
  'fixtures',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    expectedCategory: text('expected_category'),
    scope: text('scope').notNull().default('shared'),
    ownerAgent: text('owner_agent'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeIdx: index('fixtures_scope_idx').on(t.scope),
  }),
);

// ─────────────────────────────────────────────────────────
// audit_logs — 보안/통제 감사 기록 (영구)
// ─────────────────────────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    action: text('action').notNull(), // "agent.paused", "runaway.detected", etc.
    actor: text('actor'), // admin / system / agent name
    agentName: text('agent_name'),
    details: jsonb('details').$type<unknown>(),
    severity: text('severity').notNull().default('info'), // info / warn / critical
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: index('audit_agent_idx').on(t.agentName, t.createdAt),
    actionIdx: index('audit_action_idx').on(t.action),
    severityIdx: index('audit_severity_idx').on(t.severity),
  }),
);

// ─────────────────────────────────────────────────────────
// kv_state — 에이전트별 namespace KV (영구)
// ─────────────────────────────────────────────────────────
export const kvState = pgTable(
  'kv_state',
  {
    agentName: text('agent_name').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('kv_state_pk').on(t.agentName, t.key),
  }),
);

// ─────────────────────────────────────────────────────────
// rate_limit — 무한루프 감지용 카운터 (분 단위 window)
// ─────────────────────────────────────────────────────────
export const rateLimit = pgTable(
  'rate_limit',
  {
    agentName: text('agent_name').notNull(),
    window: text('window').notNull(), // YYYY-MM-DDTHH:MM
    callsCount: integer('calls_count').notNull().default(0),
    llmCount: integer('llm_count').notNull().default(0),
  },
  (t) => ({
    pk: uniqueIndex('rate_limit_pk').on(t.agentName, t.window),
  }),
);

// ─────────────────────────────────────────────────────────
// chat_messages — 대시보드 AI 채팅 (단순 Q&A)
// ─────────────────────────────────────────────────────────
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: text('session_id').notNull(),
    agentName: text('agent_name'), // 매칭된 사용자(폴더 slug) — 그 사용자의 대화 로그로 귀속
    role: text('role').notNull(), // user / assistant
    content: text('content').notNull(),
    contextSnapshot: jsonb('context_snapshot').$type<unknown>(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index('chat_session_idx').on(t.sessionId, t.createdAt),
    agentIdx: index('chat_agent_idx').on(t.agentName, t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────
// slack_user_tokens — Tier2 유저 OAuth 토큰 (암호화 저장)
// ─────────────────────────────────────────────────────────
export const slackUserTokens = pgTable(
  'slack_user_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentName: text('agent_name').notNull(),
    slackUserId: text('slack_user_id').notNull(),
    accessTokenEnc: text('access_token_enc').notNull(), // enc(access token)
    refreshTokenEnc: text('refresh_token_enc'), // enc(refresh) — 회전 시
    expiresAt: timestamp('expires_at', { withTimezone: true }), // null = 무만료
    scopes: text('scopes'),
    revoked: boolean('revoked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUniq: uniqueIndex('slack_user_tokens_user_uniq').on(t.slackUserId),
    agentIdx: index('slack_user_tokens_agent_idx').on(t.agentName),
  }),
);

// ─────────────────────────────────────────────────────────
// slack_poll_cursors — Tier2 폴링 커서 (유저×채널별 마지막 ts)
// ─────────────────────────────────────────────────────────
export const slackPollCursors = pgTable(
  'slack_poll_cursors',
  {
    slackUserId: text('slack_user_id').notNull(),
    channelId: text('channel_id').notNull(),
    lastTs: text('last_ts').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('slack_poll_cursors_pk').on(t.slackUserId, t.channelId),
  }),
);

// ─────────────────────────────────────────────────────────
// bingo_claims — 학습자가 verify 통과해서 "내가 풀었다" 표시한 빙고 칸 기록.
// 자동 검증이 통과해도 여기에 행이 없으면 done 으로 간주하지 않는다.
// 의도: 본인이 직접 들어가서 검증 받아야만 한 칸씩 채워짐.
// ─────────────────────────────────────────────────────────
export const bingoClaims = pgTable(
  'bingo_claims',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentName: text('agent_name').notNull(),
    cellId: integer('cell_id').notNull(), // 1..9
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    /** 검증 시점의 자동 체크 통과 사유 (감사용) */
    reason: text('reason'),
  },
  (t) => ({
    agentCellUniq: uniqueIndex('bingo_claims_agent_cell_uniq').on(t.agentName, t.cellId),
    agentIdx: index('bingo_claims_agent_idx').on(t.agentName),
  }),
);

// ─────────────────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────────────────
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type LlmCallRow = typeof llmCalls.$inferSelect;
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type SlackMentionRow = typeof slackMentions.$inferSelect;
export type TelegramMessageRow = typeof telegramMessages.$inferSelect;
export type SmokeRunRow = typeof smokeRuns.$inferSelect;
export type FixtureRow = typeof fixtures.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type SlackUserTokenRow = typeof slackUserTokens.$inferSelect;
export type SlackPollCursorRow = typeof slackPollCursors.$inferSelect;
export type BingoClaimRow = typeof bingoClaims.$inferSelect;

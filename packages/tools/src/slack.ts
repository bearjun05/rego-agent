import { defineTool, z, type ToolContext } from '@rego/runtime-sdk';

// ─────────────────────────────────────────────────────────
// 토큰 선택 — Phase 1 (per-user 토큰 주입)
//
// 우선순위:
//   1) ctx.agentSlackToken — 학습자가 OAuth로 연결한 본인 토큰
//   2) ctx.secret('SLACK_BOT_TOKEN') — 전역 봇 토큰 (새 rego 앱은 없음, 옛 호환용)
//   3) 둘 다 없으면 SLACK_NOT_CONNECTED throw → 친절한 안내 가능
// ─────────────────────────────────────────────────────────
export function pickSlackToken(
  agentToken: string | undefined,
  globalToken: string | undefined,
): string {
  if (agentToken) return agentToken;
  if (globalToken) return globalToken;
  throw new Error('SLACK_NOT_CONNECTED');
}

/** ctx.secret이 throw할 수 있는 케이스 대비. 전역 토큰이 없으면 undefined 반환. */
function tryGlobalBotToken(ctx: ToolContext): string | undefined {
  try {
    return ctx.secret('SLACK_BOT_TOKEN');
  } catch {
    return undefined;
  }
}

/** ctx에서 적절한 슬랙 토큰을 선택 — 학습자 본인 OAuth 토큰 우선. */
function tokenFromCtx(ctx: ToolContext): string {
  return pickSlackToken(ctx.agentSlackToken, tryGlobalBotToken(ctx));
}

// ─────────────────────────────────────────────────────────
// Slack 서명 검증 (외부 사용 가능)
// ─────────────────────────────────────────────────────────
export async function verifySlackSignature(opts: {
  signingSecret: string;
  signature: string;
  timestamp: string;
  body: string;
}): Promise<boolean> {
  const { signingSecret, signature, timestamp, body } = opts;
  if (!signature || !timestamp) return false;
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false; // 5분 이상 오래된 거 차단

  const basestring = `v0:${timestamp}:${body}`;
  // Web Crypto API (Node 20+ 표준)
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(basestring));
  const computed = `v0=${Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
  return safeCompare(computed, signature);
}

function safeCompare(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─────────────────────────────────────────────────────────
// Slack API 클라이언트 (간단한 wrapper)
// ─────────────────────────────────────────────────────────
export class SlackClient {
  constructor(
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API ${method} failed: ${data.error}`);
    }
    return data as T;
  }

  postMessage(opts: {
    channel: string;
    text: string;
    thread_ts?: string;
    blocks?: unknown[];
  }) {
    return this.call<{ ts: string; channel: string }>('chat.postMessage', opts);
  }

  addReaction(opts: { channel: string; timestamp: string; name: string }) {
    return this.call('reactions.add', opts);
  }

  getPermalink(opts: { channel: string; message_ts: string }) {
    return this.call<{ permalink: string }>('chat.getPermalink', opts);
  }

  conversationsHistory(opts: { channel: string; limit?: number; oldest?: string }) {
    return this.call<{
      messages: Array<{ ts: string; text?: string; user?: string; subtype?: string }>;
    }>('conversations.history', opts);
  }

  /** 토큰 소유자가 속한 대화 목록 (Tier2 폴링: 비공개 채널 열거에 사용). 유저 토큰 권장. */
  usersConversations(opts: { types?: string; limit?: number; exclude_archived?: boolean }) {
    return this.call<{ channels: Array<{ id: string; name?: string; is_private?: boolean }> }>(
      'users.conversations',
      opts,
    );
  }

  conversationsReplies(opts: { channel: string; ts: string }) {
    return this.call<{ messages: Array<{ ts: string; text: string; user: string }> }>(
      'conversations.replies',
      opts,
    );
  }

  conversationsInfo(opts: { channel: string }) {
    return this.call<{ channel: { id: string; name: string } }>('conversations.info', opts);
  }

  usersInfo(opts: { user: string }) {
    return this.call<{ user: { id: string; name: string; real_name?: string; profile?: { display_name?: string } } }>(
      'users.info',
      opts,
    );
  }

  search(opts: { query: string; count?: number }) {
    return this.call<{ messages: { matches: Array<{ ts: string; text: string }> } }>(
      'search.messages',
      { query: opts.query, count: opts.count ?? 20 },
    );
  }

  /** Phase 2: reactions.list — 본인이 단/받은 이모지 반응 목록 (user_token 권장) */
  reactionsList(opts: { count?: number; page?: number; full?: boolean }) {
    return this.call<{
      items: Array<{
        type: string;
        channel?: string;
        message?: { ts: string; text?: string; reactions?: Array<{ name: string; count: number }> };
      }>;
    }>('reactions.list', {
      count: opts.count ?? 100,
      page: opts.page ?? 1,
      full: opts.full ?? true,
    });
  }
}

// ─────────────────────────────────────────────────────────
// 공통 도구 (slack.* 으로 노출)
// ─────────────────────────────────────────────────────────
export const slackReply = defineTool({
  id: 'slack.reply',
  name: '슬랙 답장',
  description: '특정 슬랙 메시지에 스레드로 답장합니다',
  category: 'messaging',
  icon: '💬',
  color: '#4A154B',
  inputs: z.object({
    channel: z.string(),
    threadTs: z.string(),
    text: z.string(),
  }),
  outputs: z.object({
    ok: z.boolean(),
    ts: z.string().optional(),
  }),
  costTier: 'free',
  latencyTier: 'fast',
  sideEffects: { reads: [], writes: ['slack'] },
  secrets: ['SLACK_BOT_TOKEN'],
  async run({ channel, threadTs, text }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.postMessage({ channel, text, thread_ts: threadTs });
    ctx.logger.info('slack.reply 완료', { channel, threadTs, ts: r.ts });
    return { ok: true, ts: r.ts };
  },
});

export const slackPostMessage = defineTool({
  id: 'slack.post_message',
  name: '슬랙 메시지 보내기',
  description: '슬랙 채널에 새 메시지를 보냅니다',
  category: 'messaging',
  icon: '💬',
  color: '#4A154B',
  inputs: z.object({
    channel: z.string(),
    text: z.string(),
  }),
  outputs: z.object({
    ok: z.boolean(),
    ts: z.string().optional(),
  }),
  costTier: 'free',
  secrets: ['SLACK_BOT_TOKEN'],
  async run({ channel, text }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.postMessage({ channel, text });
    return { ok: true, ts: r.ts };
  },
});

export const slackAddReaction = defineTool({
  id: 'slack.add_reaction',
  name: '슬랙 이모지 반응',
  description: '슬랙 메시지에 이모지 반응을 답니다',
  category: 'messaging',
  icon: '👍',
  color: '#4A154B',
  inputs: z.object({
    channel: z.string(),
    timestamp: z.string(),
    emoji: z.string(),
  }),
  outputs: z.object({ ok: z.boolean() }),
  costTier: 'free',
  secrets: ['SLACK_BOT_TOKEN'],
  async run({ channel, timestamp, emoji }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    await slack.addReaction({ channel, timestamp, name: emoji.replace(/:/g, '') });
    return { ok: true };
  },
});

export const slackSearch = defineTool({
  id: 'slack.search',
  name: '슬랙 검색',
  description: '슬랙에서 메시지를 검색합니다',
  category: 'knowledge',
  icon: '🔍',
  color: '#4A154B',
  inputs: z.object({ query: z.string(), limit: z.number().int().positive().max(50).default(20) }),
  outputs: z.object({
    results: z.array(z.object({ ts: z.string(), text: z.string() })),
  }),
  costTier: 'low',
  secrets: ['SLACK_BOT_TOKEN'],
  async run({ query, limit }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.search({ query, count: limit });
    return { results: r.messages?.matches ?? [] };
  },
});

export const slackGetThread = defineTool({
  id: 'slack.get_thread',
  name: '슬랙 스레드 조회',
  description: '특정 스레드의 모든 메시지를 가져옵니다',
  category: 'knowledge',
  icon: '🧵',
  color: '#4A154B',
  inputs: z.object({ channel: z.string(), ts: z.string() }),
  outputs: z.object({
    messages: z.array(z.object({ ts: z.string(), text: z.string(), user: z.string() })),
  }),
  costTier: 'free',
  secrets: ['SLACK_BOT_TOKEN'],
  async run({ channel, ts }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.conversationsReplies({ channel, ts });
    return { messages: r.messages };
  },
});

// ─────────────────────────────────────────────────────────
// Phase 2 — 슬랙 API 명명 규칙 도구 6종 (학습자가 Slack 문서 보고 바로 쓰게)
// ─────────────────────────────────────────────────────────

export const slackUsersInfo = defineTool({
  id: 'slack.users_info',
  name: '슬랙 사용자 정보',
  description: '슬랙 user_id로 사용자 이름·프로필 조회',
  category: 'knowledge',
  icon: '👤',
  color: '#4A154B',
  inputs: z.object({ user: z.string() }),
  outputs: z.object({
    id: z.string(),
    name: z.string().optional(),
    real_name: z.string().optional(),
    display_name: z.string().optional(),
    profile: z.unknown().optional(),
  }),
  costTier: 'free',
  latencyTier: 'fast',
  async run({ user }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.usersInfo({ user });
    return {
      id: r.user.id,
      name: r.user.name,
      real_name: r.user.real_name,
      display_name: r.user.profile?.display_name,
      profile: r.user.profile,
    };
  },
});

export const slackConversationsInfo = defineTool({
  id: 'slack.conversations_info',
  name: '슬랙 채널 정보',
  description: '슬랙 channel_id로 채널 이름 등 메타 조회',
  category: 'knowledge',
  icon: '#️⃣',
  color: '#4A154B',
  inputs: z.object({ channel: z.string() }),
  outputs: z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
  costTier: 'free',
  latencyTier: 'fast',
  async run({ channel }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.conversationsInfo({ channel });
    return { id: r.channel.id, name: r.channel.name };
  },
});

export const slackReactionsAdd = defineTool({
  id: 'slack.reactions_add',
  name: '슬랙 이모지 반응 추가',
  description: '슬랙 메시지에 이모지 반응(:eyes:, :white_check_mark: 등)을 답니다',
  category: 'messaging',
  icon: '👀',
  color: '#4A154B',
  inputs: z.object({
    channel: z.string(),
    ts: z.string(),
    name: z.string().describe('이모지 이름, 콜론 없이 (예: eyes, white_check_mark)'),
  }),
  outputs: z.object({ ok: z.boolean() }),
  costTier: 'free',
  latencyTier: 'fast',
  sideEffects: { reads: [], writes: ['slack'] },
  async run({ channel, ts, name }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    // Slack API는 timestamp 필드 사용
    await slack.addReaction({ channel, timestamp: ts, name: name.replace(/:/g, '') });
    return { ok: true };
  },
});

export const slackReactionsList = defineTool({
  id: 'slack.reactions_list',
  name: '내 이모지 활동',
  description: '본인이 단/받은 이모지 반응 목록 (이모지 분석용)',
  category: 'knowledge',
  icon: '🎨',
  color: '#4A154B',
  inputs: z.object({
    count: z.number().int().positive().max(200).default(100),
    page: z.number().int().positive().default(1),
  }),
  outputs: z.object({
    items: z.array(z.unknown()),
  }),
  costTier: 'low',
  async run({ count, page }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.reactionsList({ count, page, full: true });
    return { items: r.items ?? [] };
  },
});

export const slackSearchMessages = defineTool({
  id: 'slack.search_messages',
  name: '슬랙 메시지 검색',
  description: '본인 시야로 슬랙 메시지 검색 (분석·통계용). 인덱싱 ~30s 지연 있음',
  category: 'knowledge',
  icon: '🔍',
  color: '#4A154B',
  inputs: z.object({
    query: z.string(),
    count: z.number().int().positive().max(100).default(20),
    page: z.number().int().positive().default(1),
    sort: z.enum(['score', 'timestamp']).default('timestamp'),
  }),
  outputs: z.object({
    matches: z.array(z.unknown()),
  }),
  costTier: 'low',
  async run({ query, count, page, sort }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    // SlackClient.search는 기본 인터페이스만 — 직접 호출
    const r = await slack.call<{ messages: { matches: unknown[] } }>('search.messages', {
      query,
      count,
      page,
      sort,
    });
    return { matches: r.messages?.matches ?? [] };
  },
});

export const slackConversationsHistory = defineTool({
  id: 'slack.conversations_history',
  name: '채널 히스토리',
  description: '채널의 최근 메시지를 가져옵니다',
  category: 'knowledge',
  icon: '📜',
  color: '#4A154B',
  inputs: z.object({
    channel: z.string(),
    limit: z.number().int().positive().max(100).default(20),
    oldest: z.string().optional().describe('가장 오래된 ts (포함)'),
    latest: z.string().optional().describe('가장 최근 ts (포함)'),
  }),
  outputs: z.object({
    messages: z.array(z.unknown()),
  }),
  costTier: 'low',
  async run({ channel, limit, oldest, latest }, ctx) {
    const slack = new SlackClient(tokenFromCtx(ctx));
    const r = await slack.call<{ messages: unknown[] }>('conversations.history', {
      channel,
      limit,
      ...(oldest ? { oldest } : {}),
      ...(latest ? { latest } : {}),
    });
    return { messages: r.messages ?? [] };
  },
});

export const allSlackTools = [
  // 기존 (옛 호환)
  slackReply,
  slackPostMessage,
  slackAddReaction,
  slackSearch,
  slackGetThread,
  // Phase 2 (슬랙 API 명명 규칙)
  slackUsersInfo,
  slackConversationsInfo,
  slackReactionsAdd,
  slackReactionsList,
  slackSearchMessages,
  slackConversationsHistory,
];

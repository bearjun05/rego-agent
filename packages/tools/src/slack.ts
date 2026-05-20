import { defineTool, z } from '@rego/runtime-sdk';

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
  constructor(private token: string) {}

  async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://slack.com/api/${method}`, {
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
    return this.call<{ messages: Array<{ ts: string; text: string; user: string }> }>(
      'conversations.history',
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
    const slack = new SlackClient(ctx.secret('SLACK_BOT_TOKEN'));
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
    const slack = new SlackClient(ctx.secret('SLACK_BOT_TOKEN'));
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
    const slack = new SlackClient(ctx.secret('SLACK_BOT_TOKEN'));
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
    const slack = new SlackClient(ctx.secret('SLACK_BOT_TOKEN'));
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
    const slack = new SlackClient(ctx.secret('SLACK_BOT_TOKEN'));
    const r = await slack.conversationsReplies({ channel, ts });
    return { messages: r.messages };
  },
});

export const allSlackTools = [
  slackReply,
  slackPostMessage,
  slackAddReaction,
  slackSearch,
  slackGetThread,
];

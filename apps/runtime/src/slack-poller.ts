import { and, eq } from 'drizzle-orm';
import { getDb, slackPollCursors } from '@rego/db';
import { SlackClient } from '@rego/tools/slack';
import type { SlackMentionEvent } from '@rego/runtime-sdk';
import { env } from './env.js';
import { createLogger } from './logger.js';
import { extractMentionedUserIds } from './helpers/slack-events.js';
import { listConnectedUsers, getValidAccessToken } from './slack-tokens.js';
import { ingestSlackMention } from './slack-ingest.js';

const log = createLogger('slack-poller');

// ─────────────────────────────────────────────────────────
// 순수 로직 (DB/네트워크 없음 — 단위 테스트)
// ─────────────────────────────────────────────────────────
export interface HistMsg {
  ts: string;
  text?: string;
  user?: string;
  subtype?: string;
}

/** 커서(sinceTs) 이후 메시지만. ts는 "초.마이크로" 문자열 → 숫자 비교 */
export function filterNewSince(messages: HistMsg[], sinceTs: string | null): HistMsg[] {
  const since = sinceTs ? Number(sinceTs) : 0;
  return messages.filter((m) => Number(m.ts) > since);
}

/** 대상 유저를 멘션한 메시지만 (subtype 있는 편집/봇 메시지 제외) */
export function selectMentioning(messages: HistMsg[], targetUserId: string): HistMsg[] {
  return messages.filter(
    (m) => !m.subtype && !!m.text && extractMentionedUserIds(m.text).includes(targetUserId),
  );
}

/** 메시지 배열의 최신 ts (커서 갱신용). 비어있으면 fallback */
export function maxTs(messages: HistMsg[], fallback: string): string {
  return messages.reduce((mx, m) => (Number(m.ts) > Number(mx) ? m.ts : mx), fallback);
}

/** Slack ts 포맷의 현재 시각(epoch.micros). 첫 폴링 baseline 커서용. */
export function nowSlackTs(now: number = Date.now()): string {
  return (now / 1000).toFixed(6);
}

/** 커서 없음(채널 첫 조우) 판정 — 첫 조우면 과거 히스토리를 replay하지 않는다 */
export function isFirstEncounter(cursor: string | null): boolean {
  return cursor === null;
}

// ─────────────────────────────────────────────────────────
// 폴러 서비스 (side-effect)
// ─────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function getCursor(slackUserId: string, channelId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(slackPollCursors)
    .where(and(eq(slackPollCursors.slackUserId, slackUserId), eq(slackPollCursors.channelId, channelId)));
  return row?.lastTs ?? null; // null = 커서 없음(첫 조우)
}

async function setCursor(slackUserId: string, channelId: string, lastTs: string): Promise<void> {
  const db = getDb();
  await db
    .insert(slackPollCursors)
    .values({ slackUserId, channelId, lastTs, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [slackPollCursors.slackUserId, slackPollCursors.channelId],
      set: { lastTs, updatedAt: new Date() },
    });
}

/** 한 유저의 비공개 채널을 폴링해 본인 멘션을 ingest */
async function pollUser(token: string, slackUserId: string): Promise<number> {
  const slack = new SlackClient(token);
  const conv = await slack.usersConversations({
    types: 'private_channel,mpim',
    exclude_archived: true,
    limit: 200,
  });
  let ingested = 0;
  for (const ch of conv.channels ?? []) {
    try {
      const cursor = await getCursor(slackUserId, ch.id);
      if (isFirstEncounter(cursor)) {
        // 첫 조우: 과거 무시, 현재 시각으로 baseline 후 스킵 → 다음 폴부터 "새 멘션만"
        await setCursor(slackUserId, ch.id, nowSlackTs());
        continue;
      }
      const hist = await slack.conversationsHistory({ channel: ch.id, oldest: cursor!, limit: 50 });
      const fresh = filterNewSince(hist.messages ?? [], cursor!); // 커서 경계 메시지 제외(재처리 방지)
      const hits = selectMentioning(fresh, slackUserId);
      for (const m of hits) {
        const event: SlackMentionEvent = {
          type: 'slack.mention',
          text: m.text!,
          channel: ch.id,
          channelName: ch.name,
          user: m.user ?? '',
          ts: m.ts,
          raw: { ...m, _source: 'poll' },
        };
        // 폴러: 토큰 주인에게만 라우팅(교차발송 차단)
        const res = await ingestSlackMention(event, { source: 'poll', restrictToSlackUserId: slackUserId });
        if (res.ingested) ingested += 1;
      }
      // 커서 갱신: 이번에 본 메시지의 최신 ts (멘션 없어도 진행 방지)
      const newest = maxTs(hist.messages ?? [], cursor!);
      if (newest !== cursor) await setCursor(slackUserId, ch.id, newest);
      await sleep(200); // 레이트리밋 여유
    } catch (err) {
      log.warn(`poll channel ${ch.id} failed`, err);
    }
  }
  return ingested;
}

async function pollAll(): Promise<void> {
  if (running) return; // 겹침 방지
  running = true;
  try {
    const users = await listConnectedUsers();
    for (const u of users) {
      const token = await getValidAccessToken(u.slackUserId);
      if (!token) {
        log.warn(`no valid token for ${u.slackUserId} — skip`);
        continue;
      }
      try {
        const n = await pollUser(token, u.slackUserId);
        if (n > 0) log.info(`polled ${u.slackUserId}: ${n} new mentions`);
      } catch (err) {
        log.error(`pollUser ${u.slackUserId} failed`, err);
      }
      await sleep(300);
    }
  } finally {
    running = false;
  }
}

/** server.ts에서 SLACK_POLL_ENABLED=1 일 때 시작 */
export function startSlackPoller(intervalMs?: number): void {
  const cfg = env();
  const interval = intervalMs ?? cfg.SLACK_POLL_INTERVAL_MS;
  if (timer) return;
  log.info(`starting slack poller (interval=${interval}ms)`);
  timer = setInterval(() => {
    pollAll().catch((err) => log.error('pollAll error', err));
  }, interval);
}

export function stopSlackPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

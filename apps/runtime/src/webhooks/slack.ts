import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { verifySlackSignature, SlackClient } from '@rego/tools/slack';
import { getDb, slackMentions } from '@rego/db';
import type { SlackMentionEvent } from '@rego/runtime-sdk';
import { env } from '../env.js';
import { getEventBus } from '../event-bus.js';
import { createLogger } from '../logger.js';
import { matchAgentsForEvent, runAgentForEvent } from '../agent-runner.js';

const log = createLogger('webhook:slack');

interface SlackEventPayload {
  type: 'url_verification' | 'event_callback';
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type: string;
    text?: string;
    channel?: string;
    user?: string;
    ts?: string;
    thread_ts?: string;
    item?: { type: string; channel: string; ts: string };
    reaction?: string;
  };
}

export function createSlackRouter() {
  const router = new Hono();

  router.post('/', async (c) => {
    const cfg = env();
    const signingSecret = cfg.SLACK_SIGNING_SECRET;

    const raw = await c.req.text();
    const signature = c.req.header('x-slack-signature') ?? '';
    const timestamp = c.req.header('x-slack-request-timestamp') ?? '';

    if (signingSecret) {
      const valid = await verifySlackSignature({
        signingSecret,
        signature,
        timestamp,
        body: raw,
      });
      if (!valid) {
        log.warn('signature mismatch');
        return c.json({ error: 'invalid signature' }, 401);
      }
    } else {
      log.warn('SLACK_SIGNING_SECRET not set — skipping verification (dev only)');
    }

    let payload: SlackEventPayload;
    try {
      payload = JSON.parse(raw) as SlackEventPayload;
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }

    // URL verification challenge
    if (payload.type === 'url_verification') {
      return c.json({ challenge: payload.challenge });
    }

    if (payload.type !== 'event_callback' || !payload.event) {
      return c.json({ ok: true });
    }

    const event = payload.event;
    log.info(`event: ${event.type}`);

    // 비동기로 처리 (Slack은 3초 내 응답 필요)
    queueMicrotask(() => handleSlackEvent(payload).catch((err) => log.error('handler failed', err)));

    return c.json({ ok: true });
  });

  return router;
}

async function handleSlackEvent(payload: SlackEventPayload) {
  const event = payload.event!;
  const db = getDb();
  const bus = getEventBus();
  const cfg = env();

  if (event.type === 'app_mention' || (event.type === 'message' && event.text?.includes('<@'))) {
    if (!event.text || !event.channel || !event.user || !event.ts) return;

    // dedup via event_id
    const eventId = payload.event_id;

    // 사용자/채널 이름 조회 (best-effort)
    let userName: string | undefined;
    let channelName: string | undefined;
    let permalink: string | undefined;

    if (cfg.SLACK_BOT_TOKEN) {
      try {
        const slack = new SlackClient(cfg.SLACK_BOT_TOKEN);
        const [userInfo, chanInfo] = await Promise.all([
          slack.usersInfo({ user: event.user }).catch(() => null),
          slack.conversationsInfo({ channel: event.channel }).catch(() => null),
        ]);
        userName =
          userInfo?.user.profile?.display_name ||
          userInfo?.user.real_name ||
          userInfo?.user.name;
        channelName = chanInfo?.channel.name;
        const pl = await slack.getPermalink({ channel: event.channel, message_ts: event.ts });
        permalink = pl.permalink;
      } catch (err) {
        log.warn('failed to enrich slack metadata', err);
      }
    }

    // 멘션 텍스트에서 user id 패턴을 user_name으로 치환 (있다면)
    const textResolved = event.text;

    // DB 저장
    let mentionId: number | undefined;
    try {
      const [row] = await db
        .insert(slackMentions)
        .values({
          eventId: eventId ?? null,
          teamId: payload.team_id,
          channel: event.channel,
          channelName,
          user: event.user,
          userName,
          ts: event.ts,
          threadTs: event.thread_ts,
          text: textResolved,
          permalink,
          raw: payload,
        })
        .onConflictDoNothing()
        .returning();
      mentionId = row?.id;
    } catch (err) {
      log.error('failed to record mention', err);
    }

    // 이벤트로 변환
    const agentEvent: SlackMentionEvent = {
      type: 'slack.mention',
      text: textResolved,
      channel: event.channel,
      channelName,
      user: event.user,
      userName,
      ts: event.ts,
      threadTs: event.thread_ts,
      permalink,
      raw: payload,
    };

    await bus.publish({
      type: 'slack.mention.received',
      payload: { mentionId, text: textResolved, channelName, userName },
    });

    // 매칭되는 모든 agent 실행 (사용자가 정책 자유 정의)
    const matched = matchAgentsForEvent(agentEvent, true);
    log.info(`mention matched ${matched.length} agents`);

    for (const agent of matched) {
      runAgentForEvent(agent, agentEvent, {
        sourceSlackMentionId: mentionId,
        triggeredBy: 'real',
      }).catch((err) => log.error(`agent ${agent.name} run failed`, err));
    }
  }
}

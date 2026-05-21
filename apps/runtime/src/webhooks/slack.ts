import { Hono } from 'hono';
import { verifySlackSignature, SlackClient } from '@rego/tools/slack';
import type { SlackMentionEvent } from '@rego/runtime-sdk';
import { env } from '../env.js';
import { createLogger } from '../logger.js';
import {
  shouldProcessSlackEvent,
  isChannelAllowed,
  parseChannelAllowlist,
  type RawSlackEvent,
} from '../helpers/slack-events.js';
import { resolveUserName, resolveChannelName } from '../helpers/slack-meta-cache.js';
import { ingestSlackMention } from '../slack-ingest.js';

const log = createLogger('webhook:slack');

interface SlackEventPayload {
  type: 'url_verification' | 'event_callback';
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: RawSlackEvent;
}

export function createSlackRouter() {
  const router = new Hono();

  router.post('/', async (c) => {
    const cfg = env();
    const raw = await c.req.text();

    // 1) 서명 검증 (signing secret 있으면)
    if (cfg.SLACK_SIGNING_SECRET) {
      const valid = await verifySlackSignature({
        signingSecret: cfg.SLACK_SIGNING_SECRET,
        signature: c.req.header('x-slack-signature') ?? '',
        timestamp: c.req.header('x-slack-request-timestamp') ?? '',
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

    // 2) URL verification challenge (Event Subscriptions 등록 시)
    if (payload.type === 'url_verification') {
      return c.json({ challenge: payload.challenge });
    }

    // 3) Slack 재시도(3초 내 미응답 시)는 즉시 200으로 흘려보냄 — 중복 처리 방지.
    //    (원 이벤트는 이미 비동기로 처리 중이거나 event_id dedup으로 막힘)
    const retryNum = c.req.header('x-slack-retry-num');
    if (retryNum) {
      log.info(`retry #${retryNum} ignored (${c.req.header('x-slack-retry-reason') ?? ''})`);
      return c.json({ ok: true });
    }

    if (payload.type !== 'event_callback' || !payload.event) {
      return c.json({ ok: true });
    }

    // 4) Slack은 3초 내 응답을 요구 → 즉시 200, 처리는 비동기
    queueMicrotask(() =>
      handleSlackEvent(payload).catch((err) => log.error('handler failed', err)),
    );
    return c.json({ ok: true });
  });

  return router;
}

async function handleSlackEvent(payload: SlackEventPayload) {
  const event = payload.event!;
  const cfg = env();

  // 처리 대상 판정 (subtype/봇/본인/멘션 유무) — 순수 함수
  const decision = shouldProcessSlackEvent(event, { botUserId: cfg.SLACK_BOT_USER_ID });
  if (!decision.process) {
    log.debug(`skip ${event.type}: ${decision.reason}`);
    return;
  }
  log.info(`event ${event.type}: ${decision.reason}`);

  // 메타데이터 enrich (user/channel 이름은 캐시, permalink만 매번)
  let userName: string | undefined;
  let channelName: string | undefined;
  let permalink: string | undefined;

  if (cfg.SLACK_BOT_TOKEN) {
    const slack = new SlackClient(cfg.SLACK_BOT_TOKEN);
    [userName, channelName] = await Promise.all([
      resolveUserName(slack, event.user!),
      resolveChannelName(slack, event.channel!),
    ]);
    try {
      const pl = await slack.getPermalink({ channel: event.channel!, message_ts: event.ts! });
      permalink = pl.permalink;
    } catch (err) {
      log.warn('failed to get permalink', err);
    }
  }

  // 감시 채널 allowlist (비어있으면 전체 허용)
  const allowlist = parseChannelAllowlist(cfg.SLACK_MONITOR_CHANNELS);
  if (!isChannelAllowed(event.channel, channelName, allowlist)) {
    log.debug(`skip: channel ${channelName ?? event.channel} not in allowlist`);
    return;
  }

  const agentEvent: SlackMentionEvent = {
    type: 'slack.mention',
    text: event.text!,
    channel: event.channel!,
    channelName,
    user: event.user!,
    userName,
    ts: event.ts!,
    threadTs: event.thread_ts,
    permalink,
    raw: payload,
  };

  // 저장(dedup: channel+ts) + 매칭 에이전트 실행 — Tier1/Tier2 공유 진입점.
  await ingestSlackMention(agentEvent, {
    source: 'forward',
    eventId: payload.event_id ?? null,
    teamId: payload.team_id,
    raw: payload,
  });
}

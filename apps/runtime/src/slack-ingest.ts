import { getDb, slackMentions } from '@rego/db';
import type { SlackMentionEvent } from '@rego/runtime-sdk';
import { getEventBus } from './event-bus.js';
import { createLogger } from './logger.js';
import { matchAgentsForEvent, runAgentForEvent } from './agent-runner.js';
import { mentionDedupeKey } from './helpers/slack-events.js';

const log = createLogger('slack-ingest');

export interface IngestOptions {
  /** 수신 경로 — 관측/dedup 디버깅용 */
  source: 'forward' | 'poll';
  eventId?: string | null;
  teamId?: string;
  raw?: unknown;
  /** 설정 시 그 유저의 에이전트로만 라우팅(폴러 교차발송 차단). 미설정 시 멘션된 전원. */
  restrictToSlackUserId?: string;
}

export interface IngestResult {
  ingested: boolean;
  mentionId?: number;
  matched: number;
}

/**
 * Slack 멘션을 DB에 기록(중복 제거)하고, 매칭 에이전트를 실행한다.
 * Tier1(webhook 포워딩)과 Tier2(폴링)가 공유하는 단일 진입점.
 *
 * dedup: (channel, ts) 유니크. 이미 있으면 ingested=false 로 조기 종료(에이전트 미실행).
 */
export async function ingestSlackMention(
  event: SlackMentionEvent,
  opts: IngestOptions,
): Promise<IngestResult> {
  const db = getDb();
  const bus = getEventBus();
  const key = mentionDedupeKey(event.channel, event.ts);

  let mentionId: number | undefined;
  try {
    const inserted = await db
      .insert(slackMentions)
      .values({
        eventId: opts.eventId ?? null,
        teamId: opts.teamId,
        channel: event.channel,
        channelName: event.channelName,
        user: event.user,
        userName: event.userName,
        ts: event.ts,
        threadTs: event.threadTs,
        text: event.text,
        permalink: event.permalink,
        source: opts.source,
        raw: opts.raw ?? event.raw,
      })
      .onConflictDoNothing({ target: [slackMentions.channel, slackMentions.ts] })
      .returning({ id: slackMentions.id });

    if (inserted.length === 0) {
      log.info(`duplicate ${key} (source=${opts.source}) — skip`);
      return { ingested: false, matched: 0 };
    }
    mentionId = inserted[0]?.id;
  } catch (err) {
    log.error(`failed to record mention ${key}`, err);
    return { ingested: false, matched: 0 };
  }

  const matched = matchAgentsForEvent(event, true, opts.restrictToSlackUserId);
  log.info(`mention ${key} matched ${matched.length} agents (source=${opts.source})`);

  // ★ SSE 이벤트는 매칭된 학습자 각각에 personalized 발행.
  // 예전엔 broadcast(agentName 없음)였는데 모든 학습자가 "🔔 멘션 들어왔어요"를 받는 문제 발생.
  // 본인이 슬랙에서 멘션 받았을 때만 본인 채팅창에 알림이 떠야 함.
  for (const agent of matched) {
    await bus.publish({
      type: 'slack.mention.received',
      agentName: agent.name,
      payload: {
        mentionId,
        source: opts.source,
        text: event.text,
        channelName: event.channelName,
        userName: event.userName,
      },
    });
    runAgentForEvent(agent, event, {
      sourceSlackMentionId: mentionId,
      triggeredBy: 'real',
    }).catch((e) => log.error(`agent ${agent.name} run failed`, e));
  }

  return { ingested: true, mentionId, matched: matched.length };
}

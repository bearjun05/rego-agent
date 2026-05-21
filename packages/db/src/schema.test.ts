import { describe, it, expect } from 'vitest';
import * as schema from './schema.js';

describe('schema exports', () => {
  it('모든 테이블이 export 되어 있음', () => {
    expect(schema.agents).toBeDefined();
    expect(schema.events).toBeDefined();
    expect(schema.runs).toBeDefined();
    expect(schema.llmCalls).toBeDefined();
    expect(schema.toolCalls).toBeDefined();
    expect(schema.slackMentions).toBeDefined();
    expect(schema.telegramMessages).toBeDefined();
    expect(schema.smokeRuns).toBeDefined();
    expect(schema.fixtures).toBeDefined();
    expect(schema.auditLogs).toBeDefined();
    expect(schema.kvState).toBeDefined();
    expect(schema.rateLimit).toBeDefined();
    expect(schema.chatMessages).toBeDefined();
    expect(schema.telegramPending).toBeDefined();
  });
});

describe('schema: Slack 하이브리드 (dedup + Tier2 토큰/커서)', () => {
  it('slack_mentions.source 컬럼 존재', () => {
    expect(schema.slackMentions.source).toBeDefined();
  });
  it('slack_user_tokens 정의 (암호화 토큰 컬럼)', () => {
    expect(schema.slackUserTokens.slackUserId).toBeDefined();
    expect(schema.slackUserTokens.accessTokenEnc).toBeDefined();
    expect(schema.slackUserTokens.refreshTokenEnc).toBeDefined();
  });
  it('slack_poll_cursors 정의 (커서)', () => {
    expect(schema.slackPollCursors.lastTs).toBeDefined();
    expect(schema.slackPollCursors.channelId).toBeDefined();
  });
});

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

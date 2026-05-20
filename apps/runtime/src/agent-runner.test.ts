import { describe, it, expect } from 'vitest';
import { matchAgentsForEvent } from './agent-runner.js';

describe('matchAgentsForEvent', () => {
  it('빈 레지스트리에서는 빈 배열 반환', () => {
    const result = matchAgentsForEvent({
      type: 'slack.mention',
      text: '@whoever hello',
      channel: 'C1',
      user: 'U1',
      ts: '1',
      raw: {},
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe('runtime exports', () => {
  it('AgentRunner module structure', async () => {
    const mod = await import('./agent-runner.js');
    expect(typeof mod.runAgentForEvent).toBe('function');
    expect(typeof mod.runAgentByName).toBe('function');
    expect(typeof mod.matchAgentsForEvent).toBe('function');
  });
});

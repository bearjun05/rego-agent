import { describe, it, expect } from 'vitest';
import { matchAgentsForEvent, filterMatchedToOwner } from './agent-runner.js';
import type { LoadedAgent } from './agent-registry.js';

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

describe('filterMatchedToOwner (폴러 교차라우팅 차단)', () => {
  const A = (name: string) => ({ name }) as LoadedAgent;
  it('주인 slug 하나로 제한 (다중멘션이어도 남 제외)', () => {
    const r = filterMatchedToOwner([A('uj_choe'), A('gc_yang'), A('sohee_park')], 'uj_choe');
    expect(r.map((a) => a.name)).toEqual(['uj_choe']);
  });
  it('주인이 매칭 목록에 없으면 빈 배열', () => {
    expect(filterMatchedToOwner([A('gc_yang')], 'uj_choe')).toEqual([]);
  });
  it('ownerSlug 미상(undefined)이면 빈 배열 (아무에게도 안 감)', () => {
    expect(filterMatchedToOwner([A('uj_choe')], undefined)).toEqual([]);
  });
});

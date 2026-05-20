import { describe, it, expect } from 'vitest';
import { estimateCost, createLlmApi } from './llm.js';

describe('estimateCost', () => {
  it('haiku 가격 추정', () => {
    const cost = estimateCost('anthropic/claude-haiku-4.5', 1000, 500);
    // (1000 * 1 + 500 * 5) / 1_000_000 = 0.0035
    expect(cost).toBeCloseTo(0.0035, 5);
  });

  it('알려지지 않은 모델은 sonnet 가격으로 fallback', () => {
    const cost = estimateCost('unknown/model', 1000, 1000);
    // (1000 * 3 + 1000 * 15) / 1M = 0.018
    expect(cost).toBeCloseTo(0.018, 5);
  });
});

describe('createLlmApi', () => {
  it('createLlmApi가 generate/classify/generateJson 인터페이스 제공', () => {
    const api = createLlmApi({ apiKey: 'fake', agentName: 't', runId: 'r' });
    expect(typeof api.generate).toBe('function');
    expect(typeof api.classify).toBe('function');
    expect(typeof api.generateJson).toBe('function');
  });
});

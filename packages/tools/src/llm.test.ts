import { describe, it, expect } from 'vitest';
import { estimateCost, createLlmApi, extractJson } from './llm.js';

describe('extractJson', () => {
  it('순수 JSON 파싱', () => {
    expect(extractJson('{"category":"question","confidence":0.9}')).toEqual({
      category: 'question',
      confidence: 0.9,
    });
  });

  it('```json 코드블록 제거', () => {
    const text = '```json\n{"category":"request","confidence":0.8}\n```';
    expect(extractJson(text)).toEqual({ category: 'request', confidence: 0.8 });
  });

  it('설명 텍스트가 뒤에 붙어도 JSON만 추출', () => {
    const text = '{"category":"info","confidence":0.7}\n\n**분석:** 이건 정보 공유입니다.';
    expect(extractJson(text)).toEqual({ category: 'info', confidence: 0.7 });
  });

  it('코드블록 + 설명 둘 다 있어도', () => {
    const text = '```json\n{"category":"schedule","confidence":0.95}\n```\n\n분석: 일정 조율';
    expect(extractJson(text)).toEqual({ category: 'schedule', confidence: 0.95 });
  });
});

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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { TtlCache } from './slack-meta-cache.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('TtlCache', () => {
  it('set한 값을 TTL 내에는 반환', () => {
    const c = new TtlCache<string>(1000);
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
  });

  it('미스는 undefined', () => {
    const c = new TtlCache<string>(1000);
    expect(c.get('none')).toBeUndefined();
  });

  it('TTL 지나면 만료되어 undefined', () => {
    vi.useFakeTimers();
    const c = new TtlCache<string>(1000);
    c.set('k', 'v');
    vi.advanceTimersByTime(1001);
    expect(c.get('k')).toBeUndefined();
  });

  it('null도 유효한 캐시 값(조회했으나 없음 표시)', () => {
    const c = new TtlCache<string | null>(1000);
    c.set('k', null);
    expect(c.get('k')).toBeNull(); // undefined(미스)와 구분
  });

  it('clear로 전체 비움', () => {
    const c = new TtlCache<string>(1000);
    c.set('a', '1');
    c.clear();
    expect(c.get('a')).toBeUndefined();
  });
});

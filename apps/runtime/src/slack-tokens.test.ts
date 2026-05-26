import { describe, it, expect } from 'vitest';
import { shouldUseCached } from './slack-tokens.js';

describe('shouldUseCached (Phase 1: 토큰 캐시 TTL)', () => {
  it('엔트리 없으면 false', () => {
    expect(shouldUseCached(undefined, Date.now())).toBe(false);
  });

  it('만료 없음(null)이면 영구 유효', () => {
    expect(shouldUseCached({ token: 'x', expiresAtMs: null }, Date.now())).toBe(true);
  });

  it('만료까지 여유(skew 이상) 있으면 유효', () => {
    const now = 100_000;
    const expiresAt = now + 200_000; // 200초 후 만료
    expect(shouldUseCached({ token: 'x', expiresAtMs: expiresAt }, now)).toBe(true);
  });

  it('만료 skew 안에 들어오면 무효 (회전 트리거)', () => {
    const now = 100_000;
    const expiresAt = now + 30_000; // 30초 후 만료 — skew(60s) 안
    expect(shouldUseCached({ token: 'x', expiresAtMs: expiresAt }, now)).toBe(false);
  });

  it('이미 만료된 경우 무효', () => {
    const now = 100_000;
    const expiresAt = now - 1; // 이미 지남
    expect(shouldUseCached({ token: 'x', expiresAtMs: expiresAt }, now)).toBe(false);
  });

  it('커스텀 skew (0) — 만료 직전까지 사용', () => {
    const now = 100_000;
    const expiresAt = now + 1;
    expect(shouldUseCached({ token: 'x', expiresAtMs: expiresAt }, now, 0)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken, signState, verifyState } from './crypto.js';

describe('token 암복호화 (aes-256-gcm)', () => {
  it('round-trip 복원 + 평문 비노출', () => {
    const blob = encryptToken('xoxp-secret-123', 'k');
    expect(blob).not.toContain('xoxp-secret-123');
    expect(decryptToken(blob, 'k')).toBe('xoxp-secret-123');
  });
  it('키가 틀리면 throw', () => {
    const blob = encryptToken('v', 'k1');
    expect(() => decryptToken(blob, 'k2')).toThrow();
  });
  it('변조된 blob은 throw', () => {
    const blob = encryptToken('v', 'k');
    const tampered = blob.slice(0, -2) + (blob.endsWith('00') ? '11' : '00');
    expect(() => decryptToken(tampered, 'k')).toThrow();
  });
  it('잘못된 형식은 throw', () => {
    expect(() => decryptToken('garbage', 'k')).toThrow();
  });
});

describe('OAuth state 서명/검증 (CSRF)', () => {
  it('서명 후 검증하면 원본 payload 복원', () => {
    const s = signState('agent=uj_choe&n=abc', 'sec');
    expect(verifyState(s, 'sec')).toBe('agent=uj_choe&n=abc');
  });
  it('다른 시크릿이면 거부(null)', () => {
    const s = signState('agent=x', 'sec');
    expect(verifyState(s, 'other')).toBeNull();
  });
  it('변조되면 거부(null)', () => {
    const s = signState('agent=x', 'sec');
    expect(verifyState(s + 'z', 'sec')).toBeNull();
    expect(verifyState('bad.format', 'sec')).toBeNull();
  });
});

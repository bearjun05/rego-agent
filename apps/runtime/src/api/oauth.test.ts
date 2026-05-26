import { describe, it, expect } from 'vitest';
import { isOwnerMismatch } from './oauth.js';

describe('isOwnerMismatch (D5: 본인 확인)', () => {
  it('authed = roster → 일치 (false)', () => {
    expect(isOwnerMismatch('U07R0PZGTPA', 'U07R0PZGTPA')).toBe(false);
  });

  it('authed ≠ roster → 불일치 (true, 거부)', () => {
    // 다른 사람 자리에 본인 슬랙 연결 시도
    expect(isOwnerMismatch('U999OTHER', 'U07R0PZGTPA')).toBe(true);
  });

  it('roster id 없으면 (null) → 거부 (true)', () => {
    expect(isOwnerMismatch('U07R0PZGTPA', null)).toBe(true);
  });

  it('roster id 없으면 (undefined) → 거부 (true)', () => {
    expect(isOwnerMismatch('U07R0PZGTPA', undefined)).toBe(true);
  });

  it('빈 문자열 authed → roster와 다르므로 거부', () => {
    expect(isOwnerMismatch('', 'U07R0PZGTPA')).toBe(true);
  });
});

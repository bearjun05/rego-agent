import { describe, it, expect } from 'vitest';
import { isSafeAgentName } from './git-sync.js';

describe('isSafeAgentName (T5: path injection 방어)', () => {
  it('정상 slug 통과', () => {
    expect(isSafeAgentName('uj_choe')).toBe(true);
    expect(isSafeAgentName('hyungsub_an')).toBe(true);
    expect(isSafeAgentName('a')).toBe(true);
    expect(isSafeAgentName('a1b2_c3')).toBe(true);
    expect(isSafeAgentName('hb-stage')).toBe(true);
  });

  it('빈 문자열 거부', () => {
    expect(isSafeAgentName('')).toBe(false);
  });

  it('path traversal 패턴 거부', () => {
    expect(isSafeAgentName('../etc')).toBe(false);
    expect(isSafeAgentName('..')).toBe(false);
    expect(isSafeAgentName('.hidden')).toBe(false);
  });

  it('슬래시 / 백슬래시 거부', () => {
    expect(isSafeAgentName('a/b')).toBe(false);
    expect(isSafeAgentName('a\\b')).toBe(false);
  });

  it('셸 메타문자 거부', () => {
    expect(isSafeAgentName('a;rm')).toBe(false);
    expect(isSafeAgentName('a|b')).toBe(false);
    expect(isSafeAgentName('a&b')).toBe(false);
    expect(isSafeAgentName('a`b')).toBe(false);
    expect(isSafeAgentName('a$b')).toBe(false);
  });

  it('공백 거부', () => {
    expect(isSafeAgentName('a b')).toBe(false);
    expect(isSafeAgentName(' a')).toBe(false);
  });

  it('대문자 거부 (slug 규칙 통일)', () => {
    expect(isSafeAgentName('UJ_CHOE')).toBe(false);
    expect(isSafeAgentName('Uj_choe')).toBe(false);
  });

  it('숫자 시작 거부', () => {
    expect(isSafeAgentName('1abc')).toBe(false);
    expect(isSafeAgentName('_abc')).toBe(false);
  });

  it('30자 이내', () => {
    expect(isSafeAgentName('a' + 'b'.repeat(29))).toBe(true);
    expect(isSafeAgentName('a' + 'b'.repeat(30))).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { verifySlackSignature, pickSlackToken } from './slack.js';
import { allSlackTools } from './slack.js';

describe('verifySlackSignature', () => {
  it('서명 일치 시 true', async () => {
    const secret = 'test-secret';
    const body = '{"hello":"world"}';
    const ts = Math.floor(Date.now() / 1000).toString();

    // 직접 signature 생성 (검증과 동일 알고리즘)
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${ts}:${body}`));
    const sig = `v0=${Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;

    const ok = await verifySlackSignature({
      signingSecret: secret,
      signature: sig,
      timestamp: ts,
      body,
    });
    expect(ok).toBe(true);
  });

  it('서명 다르면 false', async () => {
    const ok = await verifySlackSignature({
      signingSecret: 'x',
      signature: 'v0=invalid',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      body: '{}',
    });
    expect(ok).toBe(false);
  });

  it('오래된 timestamp는 false (replay 방지)', async () => {
    const ok = await verifySlackSignature({
      signingSecret: 'x',
      signature: 'v0=whatever',
      timestamp: '1', // 1970
      body: '{}',
    });
    expect(ok).toBe(false);
  });
});

describe('slack 도구 메타데이터', () => {
  it('모든 도구가 id/inputs/outputs 가짐', () => {
    for (const t of allSlackTools) {
      expect(t.id.startsWith('slack.')).toBe(true);
      expect(t.inputs).toBeDefined();
      expect(t.outputs).toBeDefined();
      expect(t.category).toBeDefined();
    }
  });
});

describe('pickSlackToken (Phase 1: 토큰 선택)', () => {
  it('agent 토큰 있으면 그것 우선 사용', () => {
    expect(pickSlackToken('xoxp-agent', 'xoxb-global')).toBe('xoxp-agent');
  });

  it('agent 토큰 없고 global 있으면 global', () => {
    expect(pickSlackToken(undefined, 'xoxb-global')).toBe('xoxb-global');
  });

  it('agent 토큰 빈 문자열이면 global로 폴백', () => {
    expect(pickSlackToken('', 'xoxb-global')).toBe('xoxb-global');
  });

  it('둘 다 없으면 SLACK_NOT_CONNECTED throw', () => {
    expect(() => pickSlackToken(undefined, undefined)).toThrow('SLACK_NOT_CONNECTED');
  });

  it('둘 다 빈 문자열이면 throw', () => {
    expect(() => pickSlackToken('', '')).toThrow('SLACK_NOT_CONNECTED');
  });
});

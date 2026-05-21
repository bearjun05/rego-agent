import { describe, it, expect, vi } from 'vitest';
import {
  buildSlackAuthorizeUrl,
  isTokenExpired,
  exchangeCode,
  refreshUserToken,
  USER_SCOPES,
} from './slack-oauth.js';

describe('buildSlackAuthorizeUrl', () => {
  it('필수 파라미터 포함', () => {
    const u = new URL(
      buildSlackAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://r/cb', state: 's1' }),
    );
    expect(u.origin + u.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('user_scope')).toBe(USER_SCOPES.join(','));
    expect(u.searchParams.get('redirect_uri')).toBe('https://r/cb');
    expect(u.searchParams.get('state')).toBe('s1');
  });
  it('커스텀 스코프 반영', () => {
    const u = new URL(
      buildSlackAuthorizeUrl({ clientId: 'c', redirectUri: 'r', state: 's', userScopes: ['search:read'] }),
    );
    expect(u.searchParams.get('user_scope')).toBe('search:read');
  });
});

describe('isTokenExpired', () => {
  const now = 1_000_000;
  it('만료 전 false', () => {
    expect(isTokenExpired(now + 5 * 60_000, now)).toBe(false);
  });
  it('스큐(60s) 안으로 들어오면 true', () => {
    expect(isTokenExpired(now + 30_000, now)).toBe(true);
  });
  it('무만료(null/0)는 false', () => {
    expect(isTokenExpired(null, now)).toBe(false);
    expect(isTokenExpired(0, now)).toBe(false);
  });
});

describe('exchangeCode', () => {
  it('oauth.v2.access 호출 + authed_user 토큰 파싱', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        authed_user: { id: 'U1', access_token: 'xoxp-x', expires_in: 43200, scope: 'search:read' },
        team: { id: 'T1', name: 'team' },
      }),
    } as unknown as Response);
    const r = await exchangeCode({ clientId: 'c', clientSecret: 's', code: 'code1', redirectUri: 'https://r/cb', fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.authed_user?.access_token).toBe('xoxp-x');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://slack.com/api/oauth.v2.access');
    expect(String((init as RequestInit).body)).toContain('code1');
  });

  it('에러 응답 그대로 반환', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: 'invalid_code' }),
    } as unknown as Response);
    const r = await exchangeCode({ clientId: 'c', clientSecret: 's', code: 'bad', redirectUri: 'r', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_code');
  });
});

describe('refreshUserToken', () => {
  it('grant_type=refresh_token 으로 호출', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, authed_user: { id: 'U1', access_token: 'xoxp-new', refresh_token: 'xoxe-new', expires_in: 43200 } }),
    } as unknown as Response);
    const r = await refreshUserToken({ clientId: 'c', clientSecret: 's', refreshToken: 'xoxe-old', fetchImpl });
    expect(r.authed_user?.access_token).toBe('xoxp-new');
    const body = String((fetchImpl.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('xoxe-old');
  });
});

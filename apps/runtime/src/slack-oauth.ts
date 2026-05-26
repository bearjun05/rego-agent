// ─────────────────────────────────────────────────────────
// Slack OAuth v2 — Tier2 유저 토큰 발급/회전.
// 순수 함수(URL/만료판정)와 네트워크 함수(fetch 주입 가능)를 분리해 테스트 가능하게.
// ─────────────────────────────────────────────────────────

/** rego 전용 Slack 앱 매니페스트의 user scopes 18종 (v2 앱 매니페스트와 동기). */
export const USER_SCOPES = [
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'users:read',
  'users:read.email',
  'users.profile:read',
  'team:read',
  'chat:write',
  'reactions:write',
  'reactions:read',
  'emoji:read',
  'files:read',
  'links:read',
  'pins:read',
  'bookmarks:read',
  'search:read',
  'usergroups:read',
];

/** authorize URL 생성 (순수) */
export function buildSlackAuthorizeUrl(o: {
  clientId: string;
  redirectUri: string;
  state: string;
  userScopes?: string[];
}): string {
  const u = new URL('https://slack.com/oauth/v2/authorize');
  u.searchParams.set('client_id', o.clientId);
  u.searchParams.set('user_scope', (o.userScopes ?? USER_SCOPES).join(','));
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('state', o.state);
  return u.toString();
}

/**
 * 토큰 만료 판정 (순수). expiresAtMs가 falsy(0/null/undefined)면 무만료로 간주.
 * skewMs 만큼 미리 만료로 본다(갱신 여유).
 */
export function isTokenExpired(
  expiresAtMs: number | null | undefined,
  now: number = Date.now(),
  skewMs = 60_000,
): boolean {
  if (!expiresAtMs) return false;
  return now >= expiresAtMs - skewMs;
}

export interface OAuthAccessResponse {
  ok: boolean;
  error?: string;
  authed_user?: {
    id: string;
    access_token?: string;
    token_type?: string;
    refresh_token?: string;
    expires_in?: number; // seconds (회전 활성 시)
    scope?: string;
  };
  team?: { id: string; name?: string };
}

/** authorization code → 토큰 교환 (oauth.v2.access). fetch 주입 가능 */
export async function exchangeCode(o: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthAccessResponse> {
  const f = o.fetchImpl ?? fetch;
  const res = await f('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: o.clientId,
      client_secret: o.clientSecret,
      code: o.code,
      redirect_uri: o.redirectUri,
    }),
  });
  return (await res.json()) as OAuthAccessResponse;
}

/** refresh_token → 새 access (회전). 응답에 새 refresh_token 포함될 수 있음. fetch 주입 가능 */
export async function refreshUserToken(o: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthAccessResponse> {
  const f = o.fetchImpl ?? fetch;
  const res = await f('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: o.clientId,
      client_secret: o.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: o.refreshToken,
    }),
  });
  return (await res.json()) as OAuthAccessResponse;
}

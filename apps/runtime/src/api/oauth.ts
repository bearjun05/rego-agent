import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, agents } from '@rego/db';
import { env } from '../env.js';
import { createLogger } from '../logger.js';
import { signState, verifyState } from '../crypto.js';
import { buildSlackAuthorizeUrl, exchangeCode } from '../slack-oauth.js';
import { saveUserToken } from '../slack-tokens.js';

/**
 * D5 본인 확인 — 콜백에서 받은 slack user id가 그 agent 슬롯의 등록된 user id와 일치하는지.
 * 일치하지 않으면 다른 사람 자리에 본인 슬랙 연결을 시도한 것 → 거부.
 *
 * 순수 함수 (테스트 가능).
 *
 * @returns true면 거부해야 함 (불일치 또는 roster 미등록)
 */
export function isOwnerMismatch(
  authedId: string,
  rosterId: string | null | undefined,
): boolean {
  if (!rosterId) return true; // roster에 없는 자리 → 거부
  return authedId !== rosterId;
}

const log = createLogger('oauth');

/** state 서명 시크릿 (OAuth CSRF). 우선순위: 전용 → ADMIN_PASSWORD → TOKEN_ENC_KEY */
function stateSecret(): string {
  return (
    process.env.OAUTH_STATE_SECRET ||
    process.env.ADMIN_PASSWORD ||
    process.env.TOKEN_ENC_KEY ||
    'rego-oauth-dev'
  );
}

export function createOAuthApi() {
  const r = new Hono();

  // GET /oauth/slack?agent=<name> — 참가자가 본인 Slack 연결 시작
  r.get('/slack', (c) => {
    const cfg = env();
    const agent = c.req.query('agent')?.trim();
    if (!agent) return c.text('agent 파라미터가 필요합니다 (?agent=<본인 이름>)', 400);
    if (!cfg.SLACK_CLIENT_ID || !cfg.SLACK_OAUTH_REDIRECT) {
      return c.text('Slack OAuth가 설정되지 않았어요 (SLACK_CLIENT_ID / SLACK_OAUTH_REDIRECT).', 503);
    }
    const nonce = randomBytes(8).toString('hex');
    const state = signState(`agent=${encodeURIComponent(agent)}&n=${nonce}&t=${Date.now()}`, stateSecret());
    const url = buildSlackAuthorizeUrl({
      clientId: cfg.SLACK_CLIENT_ID,
      redirectUri: cfg.SLACK_OAUTH_REDIRECT,
      state,
    });
    return c.redirect(url);
  });

  // GET /oauth/slack/callback?code&state — Slack 인증 후 콜백
  r.get('/slack/callback', async (c) => {
    const cfg = env();
    const code = c.req.query('code');
    const state = c.req.query('state') ?? '';
    const slackError = c.req.query('error');
    if (slackError) return c.html(page('연결 취소됨', `Slack에서 거부됨: ${escapeHtml(slackError)}`), 400);
    if (!code) return c.html(page('실패', 'code가 없습니다.'), 400);

    const payload = verifyState(state, stateSecret());
    if (!payload) return c.html(page('실패', 'state 검증 실패 (만료/위조).'), 400);
    const agent = new URLSearchParams(payload).get('agent');
    if (!agent) return c.html(page('실패', 'state에 agent 없음.'), 400);

    if (!cfg.SLACK_CLIENT_ID || !cfg.SLACK_CLIENT_SECRET || !cfg.SLACK_OAUTH_REDIRECT) {
      return c.html(page('실패', 'Slack OAuth 미설정.'), 503);
    }
    if (!process.env.TOKEN_ENC_KEY) {
      return c.html(page('실패', 'TOKEN_ENC_KEY 미설정 — 토큰 저장 불가.'), 503);
    }

    try {
      const resp = await exchangeCode({
        clientId: cfg.SLACK_CLIENT_ID,
        clientSecret: cfg.SLACK_CLIENT_SECRET,
        code,
        redirectUri: cfg.SLACK_OAUTH_REDIRECT,
      });
      const u = resp.authed_user;
      if (!resp.ok || !u?.access_token || !u.id) {
        log.error(`oauth exchange failed: ${resp.error ?? 'no user token'}`);
        return c.html(page('실패', `토큰 교환 실패: ${escapeHtml(resp.error ?? 'unknown')}`), 400);
      }

      // D5: 본인 확인 — roster에 등록된 slack_user_id와 일치해야 함
      const db = getDb();
      const [rosterRow] = await db
        .select({ slackUserId: agents.slackUserId })
        .from(agents)
        .where(eq(agents.name, agent));
      const rosterId = rosterRow?.slackUserId;
      if (isOwnerMismatch(u.id, rosterId)) {
        log.warn(`owner mismatch: agent=${agent} authed=${u.id} roster=${rosterId ?? 'NONE'}`);
        const msg = !rosterId
          ? `등록되지 않은 자리예요: <code>${escapeHtml(agent)}</code>`
          : `본인 Slack 계정으로 연결해주세요. 이 자리(<code>${escapeHtml(agent)}</code>)는 다른 사용자로 등록돼 있어요.`;
        return c.html(page('연결 거부', msg), 403);
      }

      await saveUserToken({
        agentName: agent,
        slackUserId: u.id,
        accessToken: u.access_token,
        refreshToken: u.refresh_token ?? null,
        expiresInSec: u.expires_in ?? null,
        scopes: u.scope ?? null,
      });
      log.info(`oauth connected: agent=${agent} user=${u.id}`);
      return c.html(page('연결 완료 ✅', `${escapeHtml(agent)} 님의 Slack이 연결됐어요. 이제 비공개 채널 멘션도 처리됩니다. 창을 닫아도 됩니다.`));
    } catch (err) {
      log.error('oauth callback error', err);
      return c.html(page('실패', '서버 오류가 발생했어요.'), 500);
    }
  });

  return r;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<div style="font-family:system-ui;max-width:480px;margin:60px auto;padding:24px;border:1px solid #eee;border-radius:12px">
<h2>${escapeHtml(title)}</h2><p>${body}</p></div>`;
}

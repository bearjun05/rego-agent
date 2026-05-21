import { eq } from 'drizzle-orm';
import { getDb, slackUserTokens, type SlackUserTokenRow } from '@rego/db';
import { env } from './env.js';
import { createLogger } from './logger.js';
import { encryptToken, decryptToken } from './crypto.js';
import { isTokenExpired, refreshUserToken } from './slack-oauth.js';

const log = createLogger('slack-tokens');

function encKey(): string {
  const k = process.env.TOKEN_ENC_KEY;
  if (!k) throw new Error('TOKEN_ENC_KEY not set');
  return k;
}

/** OAuth 콜백에서 받은 유저 토큰을 암호화 저장(upsert). */
export async function saveUserToken(input: {
  agentName: string;
  slackUserId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresInSec?: number | null;
  scopes?: string | null;
}): Promise<void> {
  const db = getDb();
  const key = encKey();
  const expiresAt =
    input.expiresInSec && input.expiresInSec > 0
      ? new Date(Date.now() + input.expiresInSec * 1000)
      : null;
  const values = {
    agentName: input.agentName,
    slackUserId: input.slackUserId,
    accessTokenEnc: encryptToken(input.accessToken, key),
    refreshTokenEnc: input.refreshToken ? encryptToken(input.refreshToken, key) : null,
    expiresAt,
    scopes: input.scopes ?? null,
    revoked: false,
    updatedAt: new Date(),
  };
  await db
    .insert(slackUserTokens)
    .values(values)
    .onConflictDoUpdate({ target: slackUserTokens.slackUserId, set: values });
  log.info(`saved user token for ${input.slackUserId} (agent=${input.agentName})`);
}

/** 폴러용 — revoked 아닌 연결 전체 (토큰 평문 미포함). */
export async function listConnectedUsers(): Promise<SlackUserTokenRow[]> {
  const db = getDb();
  return db.select().from(slackUserTokens).where(eq(slackUserTokens.revoked, false));
}

/**
 * 유효한 access token(평문) 반환. 만료 임박 + refresh 있으면 회전 후 재저장.
 * 토큰 없음/취소/회전실패 시 null.
 */
export async function getValidAccessToken(slackUserId: string): Promise<string | null> {
  const db = getDb();
  const key = encKey();
  const [row] = await db
    .select()
    .from(slackUserTokens)
    .where(eq(slackUserTokens.slackUserId, slackUserId));
  if (!row || row.revoked) return null;

  const expMs = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
  if (!isTokenExpired(expMs)) {
    return decryptToken(row.accessTokenEnc, key);
  }

  // 만료 임박 → refresh
  if (!row.refreshTokenEnc) {
    return decryptToken(row.accessTokenEnc, key); // 회전 비활성 토큰(무만료 가정)
  }
  const cfg = env();
  if (!cfg.SLACK_CLIENT_ID || !cfg.SLACK_CLIENT_SECRET) {
    log.warn('cannot refresh: SLACK_CLIENT_ID/SECRET not set');
    return null;
  }
  try {
    const refresh = decryptToken(row.refreshTokenEnc, key);
    const r = await refreshUserToken({
      clientId: cfg.SLACK_CLIENT_ID,
      clientSecret: cfg.SLACK_CLIENT_SECRET,
      refreshToken: refresh,
    });
    const at = r.authed_user?.access_token;
    if (!r.ok || !at) {
      log.error(`refresh failed for ${slackUserId}: ${r.error ?? 'no access_token'}`);
      return null;
    }
    await saveUserToken({
      agentName: row.agentName,
      slackUserId,
      accessToken: at,
      refreshToken: r.authed_user?.refresh_token ?? refresh,
      expiresInSec: r.authed_user?.expires_in ?? null,
      scopes: r.authed_user?.scope ?? row.scopes,
    });
    return at;
  } catch (err) {
    log.error(`refresh threw for ${slackUserId}`, err);
    return null;
  }
}

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

// ─────────────────────────────────────────────────────────
// In-memory 캐시 + per-user mutex (Phase 1: per-run DB read/refresh 회피)
// ─────────────────────────────────────────────────────────

interface TokenCacheEntry {
  token: string;
  /** ms epoch. null이면 무만료 (회전 비활성 토큰) */
  expiresAtMs: number | null;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const refreshMutex = new Map<string, Promise<string | null>>();

/**
 * 캐시된 토큰을 사용해도 되는지 판정 (순수 함수).
 * 만료 skewMs 전까지는 유효로 본다.
 */
export function shouldUseCached(
  entry: TokenCacheEntry | undefined,
  now: number,
  skewMs = 60_000,
): boolean {
  if (!entry) return false;
  if (entry.expiresAtMs === null) return true; // 무만료
  return now < entry.expiresAtMs - skewMs;
}

/** 캐시 비우기 (revoke / 회전 실패 시) */
export function invalidateTokenCache(slackUserId: string): void {
  tokenCache.delete(slackUserId);
}

/** 테스트 전용 — 캐시 전체 리셋 */
export function _resetTokenCache(): void {
  tokenCache.clear();
  refreshMutex.clear();
}

// ─────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────

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
  // 새 토큰 저장 시 캐시도 갱신 (다음 호출에서 DB 안 침)
  tokenCache.set(input.slackUserId, {
    token: input.accessToken,
    expiresAtMs: expiresAt ? expiresAt.getTime() : null,
  });
  log.info(`saved user token for ${input.slackUserId} (agent=${input.agentName})`);
}

/** 폴러용 — revoked 아닌 연결 전체 (토큰 평문 미포함). */
export async function listConnectedUsers(): Promise<SlackUserTokenRow[]> {
  const db = getDb();
  return db.select().from(slackUserTokens).where(eq(slackUserTokens.revoked, false));
}

/**
 * 유효한 access token(평문) 반환. 만료 임박 + refresh 있으면 회전 후 재저장.
 *
 * 동작:
 * 1. 캐시 유효 → 즉시 반환 (DB read 0)
 * 2. 캐시 만료/없음 → DB 조회 → 만료 안 됐으면 캐시 채우고 반환
 * 3. 만료 임박 + refresh 있음 → mutex 안에서 회전 (동시 호출 직렬화)
 * 4. 토큰 없음/취소/회전실패 → null
 */
export async function getValidAccessToken(slackUserId: string): Promise<string | null> {
  // 1. 캐시 확인
  const cached = tokenCache.get(slackUserId);
  if (shouldUseCached(cached, Date.now())) {
    return cached!.token;
  }

  // 2. 진행 중인 refresh 있으면 같이 대기 (race 차단)
  const pending = refreshMutex.get(slackUserId);
  if (pending) return pending;

  // 3. 새 refresh 시작
  const promise = doFetchOrRefresh(slackUserId).finally(() => {
    refreshMutex.delete(slackUserId);
  });
  refreshMutex.set(slackUserId, promise);
  return promise;
}

async function doFetchOrRefresh(slackUserId: string): Promise<string | null> {
  const db = getDb();
  const key = encKey();
  const [row] = await db
    .select()
    .from(slackUserTokens)
    .where(eq(slackUserTokens.slackUserId, slackUserId));
  if (!row || row.revoked) {
    invalidateTokenCache(slackUserId);
    return null;
  }

  const expMs = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
  if (!isTokenExpired(expMs)) {
    const token = decryptToken(row.accessTokenEnc, key);
    tokenCache.set(slackUserId, { token, expiresAtMs: expMs });
    return token;
  }

  // 만료 임박 → refresh
  if (!row.refreshTokenEnc) {
    const token = decryptToken(row.accessTokenEnc, key);
    tokenCache.set(slackUserId, { token, expiresAtMs: null }); // 회전 비활성 = 무만료 가정
    return token;
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
      invalidateTokenCache(slackUserId);
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
    invalidateTokenCache(slackUserId);
    return null;
  }
}

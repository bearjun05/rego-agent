import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** 임의 문자열 → 32바이트 키 (aes-256) */
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * 토큰 암호화 (aes-256-gcm). 반환 형식: "iv:tag:cipher" (모두 hex).
 * 평문이 결과에 노출되지 않으며, 키가 틀리면 복호화 시 throw.
 */
export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

export function decryptToken(blob: string, secret: string): string {
  const [ivH, tagH, dataH] = blob.split(':');
  if (!ivH || !tagH || !dataH) throw new Error('invalid token blob');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
}

/**
 * OAuth state 서명/검증 (CSRF 방지). payload를 base64url + HMAC-SHA256 태그로 묶는다.
 * 형식: "<base64url(payload)>.<hex(hmac)>"
 */
export function signState(payload: string, secret: string): string {
  const b = Buffer.from(payload, 'utf8').toString('base64url');
  const tag = createHmac('sha256', secret).update(b).digest('hex');
  return `${b}.${tag}`;
}

export function verifyState(state: string, secret: string): string | null {
  const [b, tag] = state.split('.');
  if (!b || !tag) return null;
  const expected = createHmac('sha256', secret).update(b).digest('hex');
  const a = Buffer.from(tag);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
  try {
    return Buffer.from(b, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// Slack 이벤트 판정 — 순수 함수 (DB/네트워크 의존 없음 → 단위 테스트 가능)
//
// 왜 필요한가:
// - app_mention 이벤트는 "봇이 멘션될 때만" 발생한다. 스터디 참가자(사람)가
//   태그될 때를 감지하려면 message.channels / message.groups 이벤트를 받아
//   본문의 <@U…>를 직접 파싱해야 한다. (Slack 앱 Event Subscriptions 설정 필요)
// - message 이벤트는 edited/deleted/봇메시지 등 다양한 subtype을 함께 흘려보내므로
//   필터링하지 않으면 노이즈·중복 실행·무한루프 위험이 있다.
// ─────────────────────────────────────────────────────────

export interface RawSlackEvent {
  type: string;
  subtype?: string;
  text?: string;
  channel?: string;
  user?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  item?: { type: string; channel: string; ts: string };
  reaction?: string;
}

/**
 * 본문에서 멘션된 슬랙 유저 ID 추출.
 * 형식: <@U123>, <@W123>, <@U123|fallback>. 채널(<#C..>)·유저그룹(<!subteam..>)은 제외.
 */
export function extractMentionedUserIds(text: string): string[] {
  return [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)]
    .map((m) => m[1])
    .filter((x): x is string => !!x);
}

export interface ProcessDecision {
  process: boolean;
  reason: string;
}

/**
 * 이 Slack 이벤트를 멘션으로 처리해야 하는지 판정.
 * @param botUserId 봇 자신의 user id (있으면 self-message 무시 — 무한루프 방지)
 */
export function shouldProcessSlackEvent(
  event: RawSlackEvent,
  opts: { botUserId?: string } = {},
): ProcessDecision {
  // 봇이 보낸 메시지 무시 (우리 봇의 답장 포함 → 루프 차단)
  if (event.bot_id) return { process: false, reason: 'bot_message' };
  if (opts.botUserId && event.user === opts.botUserId) {
    return { process: false, reason: 'self_message' };
  }

  // 봇이 직접 멘션됨 — 항상 처리 (기존 동작 보존)
  if (event.type === 'app_mention') {
    if (!event.text || !event.channel || !event.user || !event.ts) {
      return { process: false, reason: 'incomplete' };
    }
    return { process: true, reason: 'app_mention' };
  }

  // 일반 채널 메시지 — subtype 없는 사람 메시지만
  if (event.type === 'message') {
    if (event.subtype) return { process: false, reason: `subtype:${event.subtype}` };
    if (!event.text || !event.channel || !event.user || !event.ts) {
      return { process: false, reason: 'incomplete' };
    }
    // 사람 멘션(<@U…>)이 없는 잡담은 무시 → LLM 비용/노이즈 절감
    if (extractMentionedUserIds(event.text).length === 0) {
      return { process: false, reason: 'no_mention' };
    }
    return { process: true, reason: 'message_with_mention' };
  }

  return { process: false, reason: `ignored_type:${event.type}` };
}

/**
 * 감시 채널 allowlist 검사. allowlist가 비어있으면 전체 허용.
 * 항목은 채널 ID(C0…) 또는 채널명("우리팀_잡담", "#잡담") 모두 허용.
 */
export function isChannelAllowed(
  channelId: string | undefined,
  channelName: string | undefined,
  allowlist: string[],
): boolean {
  if (allowlist.length === 0) return true;
  const norm = (s: string) => s.replace(/^#/, '').trim().toLowerCase();
  const set = new Set(allowlist.map(norm).filter(Boolean));
  if (channelId && set.has(norm(channelId))) return true;
  if (channelName && set.has(norm(channelName))) return true;
  return false;
}

/** "a, b ,c" → ["a","b","c"] (env 파싱용) */
export function parseChannelAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Tier1(forward)/Tier2(poll) 공통 dedup 키. Slack 메시지 정체성 = (channel, ts).
 * DB는 (channel, ts) 유니크로 강제하지만, 인메모리/로그 식별에도 사용.
 */
export function mentionDedupeKey(channelId: string, ts: string): string {
  return `${channelId}:${ts}`;
}

// ─────────────────────────────────────────────────────────
// Slack 메타데이터 캐시 — users.info / conversations.info 결과를 메모리 TTL 캐시.
// 멘션마다 Slack API를 3번(user/channel/permalink) 때리던 것을, 잘 안 바뀌는
// user/channel 이름은 캐시하고 permalink만 매번 호출하도록 줄인다.
// (단일 프로세스 캐시 — Railway 재배포 시 초기화되며 그래도 무방)
// ─────────────────────────────────────────────────────────
import type { SlackClient } from '@rego/tools/slack';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.map.clear();
  }
}

// null = 조회했으나 이름 없음(재조회 안 함), undefined = 캐시 미스
const userNameCache = new TtlCache<string | null>(10 * 60_000); // 10분
const channelNameCache = new TtlCache<string | null>(30 * 60_000); // 30분

/** 유저 표시 이름 (캐시) */
export async function resolveUserName(
  slack: SlackClient,
  userId: string,
): Promise<string | undefined> {
  const cached = userNameCache.get(userId);
  if (cached !== undefined) return cached ?? undefined;
  try {
    const info = await slack.usersInfo({ user: userId });
    const name =
      info?.user.profile?.display_name || info?.user.real_name || info?.user.name || null;
    userNameCache.set(userId, name);
    return name ?? undefined;
  } catch {
    userNameCache.set(userId, null); // 실패도 잠깐 캐시 (rate-limit 회피)
    return undefined;
  }
}

/** 채널 이름 (캐시) */
export async function resolveChannelName(
  slack: SlackClient,
  channelId: string,
): Promise<string | undefined> {
  const cached = channelNameCache.get(channelId);
  if (cached !== undefined) return cached ?? undefined;
  try {
    const info = await slack.conversationsInfo({ channel: channelId });
    const name = info?.channel.name || null;
    channelNameCache.set(channelId, name);
    return name ?? undefined;
  } catch {
    channelNameCache.set(channelId, null);
    return undefined;
  }
}

/** 테스트/운영용 — 캐시 비우기 */
export function clearSlackMetaCaches(): void {
  userNameCache.clear();
  channelNameCache.clear();
}

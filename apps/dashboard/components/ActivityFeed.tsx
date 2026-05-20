'use client';
import { useEffect, useState } from 'react';
import { useSseEvents } from '@/lib/sse';
import { fmtRelativeTime } from '@/lib/utils';

interface FeedItem {
  id: number | string;
  ts: string;
  type: string;
  agentName?: string;
  payload?: Record<string, unknown>;
}

// 비개발자가 보는 활동만 (개발틱한 이벤트·감사로그 제외)
const VISIBLE = new Set([
  'github.push',
  'agent.analyzed',
  'telegram.registered',
  'slack.mention.received',
  'run.finished',
]);

export function ActivityFeed() {
  const live = useSseEvents(40);
  const [history, setHistory] = useState<FeedItem[]>([]);
  const [names, setNames] = useState<Record<string, { displayName: string; icon: string }>>({});

  useEffect(() => {
    // 에이전트 이름/아이콘 매핑 (표시용)
    fetch('/api/runtime/agents')
      .then((r) => r.json())
      .then((d: { agents?: Array<{ name: string; displayName: string | null; icon: string }> }) => {
        const m: Record<string, { displayName: string; icon: string }> = {};
        for (const a of d.agents ?? []) m[a.name] = { displayName: a.displayName ?? a.name, icon: a.icon };
        setNames(m);
      })
      .catch(() => {});

    fetch('/api/runtime/feed?limit=60')
      .then((r) => r.json())
      .then((data: { events?: Array<{ id: number; eventType: string; agentName: string | null; payload: unknown; createdAt: string }> }) => {
        if (data.events) {
          setHistory(
            data.events
              .filter((e) => VISIBLE.has(e.eventType))
              .map((e) => ({
                id: e.id,
                ts: e.createdAt,
                type: e.eventType,
                agentName: e.agentName ?? undefined,
                payload: e.payload as Record<string, unknown>,
              })),
          );
        }
      })
      .catch(() => {});
  }, []);

  // live + history 머지
  const seen = new Set<string>();
  const merged: FeedItem[] = [];
  for (const e of live) {
    if (!VISIBLE.has(e.type)) continue;
    const key = `${e.ts}-${e.type}-${e.agentName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ id: `live-${key}`, ts: e.ts, type: e.type, agentName: e.agentName, payload: e.payload as Record<string, unknown> });
  }
  for (const e of history) {
    const key = `${e.ts}-${e.type}-${e.agentName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }

  const nameOf = (slug?: string) => (slug && names[slug]?.displayName) || slug || '누군가';
  const iconOf = (slug?: string) => (slug && names[slug]?.icon) || '·';

  return (
    <div className="brut p-0 overflow-hidden">
      <div className="p-4 border-b-2 border-ink bg-ink text-paper flex items-center justify-between">
        <h2 className="font-display font-bold text-lg">실시간 활동</h2>
        <span className="font-mono text-[10px] uppercase flex items-center gap-1">
          <span className="w-2 h-2 bg-rust rounded-full animate-pulse" /> LIVE
        </span>
      </div>
      <div className="divide-y-2 divide-ink max-h-[520px] overflow-y-auto">
        {merged.length === 0 && (
          <div className="p-6 text-center text-muted text-sm">
            아직 활동이 없어요.<br />
            <span className="text-xs">누군가 코드를 올리거나 멘션을 처리하면 여기 떠요.</span>
          </div>
        )}
        {merged.slice(0, 50).map((e, i) => (
          <div key={e.id} className="p-3 hover:bg-sand transition-colors flex gap-3 fade-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-lg leading-none pt-0.5">{iconOf(e.agentName)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm">{describe(e, nameOf)}</div>
              <div className="font-mono text-[10px] uppercase text-muted mt-0.5">
                {fmtRelativeTime(e.ts)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 비개발자가 이해하는 친근한 한 줄
function describe(e: FeedItem, nameOf: (s?: string) => string): string {
  const p = e.payload ?? {};
  const who = nameOf(e.agentName);
  switch (e.type) {
    case 'agent.analyzed': {
      const summary = p.summary as string | undefined;
      return summary ? `${who}님이 만들었어요 — ${summary}` : `${who}님이 에이전트를 업데이트했어요`;
    }
    case 'github.push':
      return `누군가 코드를 새로 올렸어요 ✏️`;
    case 'telegram.registered':
      return `${who}님이 텔레그램을 연결하고 합류했어요! 🎉`;
    case 'slack.mention.received': {
      const u = p.userName as string | undefined;
      return `슬랙에서 ${u ? `${u}님의 ` : ''}멘션이 도착했어요 💬`;
    }
    case 'run.finished': {
      const status = p.status as string | undefined;
      if (status === 'success') return `${who}님의 에이전트가 메시지를 처리해서 텔레그램으로 보냈어요 📱`;
      return `${who}님의 에이전트가 메시지를 처리하다 막혔어요 (다시 시도해보세요)`;
    }
    default:
      return `${who}님의 활동`;
  }
}

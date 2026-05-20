'use client';
import { useEffect, useState } from 'react';
import { useSseEvents } from '@/lib/sse';
import { fmtRelativeTime, fmtCurrency, fmtDuration } from '@/lib/utils';

interface FeedItem {
  id: number | string;
  ts: string;
  type: string;
  agentName?: string;
  payload?: Record<string, unknown>;
}

export function ActivityFeed() {
  const live = useSseEvents(30);
  const [history, setHistory] = useState<FeedItem[]>([]);

  useEffect(() => {
    fetch('/api/runtime/feed?limit=30')
      .then((r) => r.json())
      .then((data: { events?: Array<{ id: number; eventType: string; agentName: string | null; payload: unknown; createdAt: string }> }) => {
        if (data.events) {
          setHistory(
            data.events.map((e) => ({
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

  // live + history 머지 (live가 위)
  const seen = new Set<string>();
  const merged: FeedItem[] = [];
  for (const e of live) {
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

  return (
    <div className="brut p-0 overflow-hidden">
      <div className="p-4 border-b-2 border-ink bg-ink text-paper flex items-center justify-between">
        <h2 className="font-display font-bold text-lg">▶ 실시간 활동</h2>
        <span className="font-mono text-[10px] uppercase flex items-center gap-1">
          <span className="w-2 h-2 bg-rust rounded-full animate-pulse" /> LIVE
        </span>
      </div>
      <div className="divide-y-2 divide-ink max-h-[480px] overflow-y-auto">
        {merged.length === 0 && (
          <div className="p-6 text-center text-muted text-sm">아직 활동이 없어요.</div>
        )}
        {merged.slice(0, 50).map((e, i) => (
          <div key={e.id} className="p-3 hover:bg-sand transition-colors flex gap-3 fade-up" style={{ animationDelay: `${i * 30}ms` }}>
            <div className="font-mono text-[10px] uppercase text-muted whitespace-nowrap pt-0.5 w-16">
              {fmtRelativeTime(e.ts)}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{formatEventTitle(e)}</div>
              {formatEventSubtitle(e) && (
                <div className="text-xs text-muted mt-0.5">{formatEventSubtitle(e)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatEventTitle(e: FeedItem): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'slack.mention.received':
      return `📨 ${(p.userName as string) ?? 'someone'}이 멘션을 보냈어요`;
    case 'run.started':
      return `▶ ${e.agentName}가 실행을 시작 (${(p.triggerType as string) ?? '?'})`;
    case 'run.finished':
      return `${(p.status as string) === 'success' ? '✅' : '❌'} ${e.agentName}: ${(p.status as string) ?? ''}`;
    case 'llm.called':
      return `🧠 ${e.agentName}가 LLM 호출 (${(p.model as string) ?? ''})`;
    case 'tool.called':
      return `🔧 ${e.agentName}가 도구 사용: ${(p.toolId as string) ?? ''}`;
    case 'telegram.registered':
      return `🆔 ${e.agentName}가 텔레그램을 연결했어요`;
    case 'github.push':
      return `📦 GitHub push (${(p.commits as number) ?? 0} commits)`;
    case 'audit.recorded':
      return `🛡 감사: ${(p.action as string) ?? ''}`;
    default:
      return e.type;
  }
}

function formatEventSubtitle(e: FeedItem): string | null {
  const p = e.payload ?? {};
  if (e.type === 'run.finished') {
    const cost = p.costUsd as number;
    const dur = p.durationMs as number;
    if (cost !== undefined || dur !== undefined) {
      return `${dur !== undefined ? fmtDuration(dur) : ''}${cost !== undefined ? ` · ${fmtCurrency(cost)}` : ''}`;
    }
  }
  if (e.type === 'llm.called' && p.costUsd !== undefined) {
    return fmtCurrency(p.costUsd as number);
  }
  if (e.type === 'slack.mention.received' && p.text) {
    return ((p.text as string).slice(0, 80));
  }
  return null;
}

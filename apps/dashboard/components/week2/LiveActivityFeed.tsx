'use client';
import { useEffect, useState } from 'react';

interface Activity {
  agent: string;
  type: string;
  status: string;
  at: string;
}

function timeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return '방금';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function emoji(type: string, status: string): string {
  if (status === 'failed' || status === 'timeout') return '⚠';
  if (type === 'slack.mention') return '🔔';
  if (type === 'telegram.callback') return '🎯';
  if (type === 'cron') return '⏰';
  if (type === 'manual') return '🖱';
  return '·';
}

export function LiveActivityFeed() {
  const [data, setData] = useState<Activity[]>([]);

  useEffect(() => {
    const fetchOnce = () =>
      fetch('/api/runtime/week2/activity-feed?limit=20')
        .then((r) => r.json())
        .then((d: { activity: Activity[] }) => setData(d.activity ?? []))
        .catch(() => {});
    fetchOnce();
    const interval = setInterval(fetchOnce, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="brut p-4 bg-paper">
      <div className="font-display font-bold text-sm mb-3 flex items-center justify-between">
        <span>📡 라이브 활동</span>
        <span className="font-mono text-[10px] text-muted">10초마다 갱신</span>
      </div>
      <ul className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {data.length === 0 && (
          <li className="font-mono text-xs text-muted">아직 활동 없음</li>
        )}
        {data.map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-xs font-mono">
            <span>{emoji(a.type, a.status)}</span>
            <span className="flex-1 truncate">
              <strong>{a.agent}</strong> · {a.type}
            </span>
            <span className="text-muted">{timeAgo(a.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

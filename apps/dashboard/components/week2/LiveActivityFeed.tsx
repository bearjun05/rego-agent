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

/** 트리거 type을 친숙한 한국어로 */
function triggerKo(type: string): string {
  if (type === 'slack.mention') return '슬랙 멘션';
  if (type === 'telegram.callback') return '텔레그램 버튼';
  if (type === 'cron') return '정기 발화';
  if (type === 'manual') return '수동 실행';
  if (type.startsWith('slack.')) return `슬랙 · ${type.slice(6)}`;
  if (type.startsWith('telegram.')) return `텔레그램 · ${type.slice(9)}`;
  return type;
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
    <div className="brut p-4 bg-paper self-start">
      <div className="flex items-end justify-between mb-3 pb-2 border-b border-ink/15">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Live</div>
          <div className="font-display font-bold text-base">라이브 활동 ({data.length}건)</div>
        </div>
        <span className="font-mono text-[10px] text-muted">10초마다 갱신</span>
      </div>
      <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
        {data.length === 0 && (
          <li className="font-mono text-xs text-muted">아직 활동 없음</li>
        )}
        {data.map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-xs font-mono">
            <span className="w-4 text-center">{emoji(a.type, a.status)}</span>
            <span className="flex-1 truncate">
              <strong>{a.agent}</strong> · <span className="text-ink/70">{triggerKo(a.type)}</span>
            </span>
            <span className="text-muted">{timeAgo(a.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

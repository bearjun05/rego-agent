'use client';
import { useEffect, useState } from 'react';

interface AgentRow {
  name: string;
  displayName: string | null;
  slackConnected: boolean;
  telegramConnected: boolean;
  isPaused: boolean;
  bingoDone: number;
  lastActivityMinsAgo: number | null;
  stuck: boolean;
}

interface MonitorResponse {
  total: number;
  done: number;
  active: number;
  stuck: number;
  rows: AgentRow[];
}

export function MonitorCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () =>
      fetch('/api/runtime/bingo/all')
        .then((r) => r.json())
        .then((d: MonitorResponse) => {
          if (!cancelled) {
            setData(d);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });

    fetchOnce();
    const interval = setInterval(fetchOnce, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="brut p-3 bg-paper font-mono text-xs text-muted">
        모니터링 데이터 불러오는 중...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="brut p-3 bg-paper font-mono text-xs text-rust">
        데이터를 불러오지 못했어요.
      </div>
    );
  }

  return (
    <div className="brut p-3 bg-paper">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display font-bold text-sm">📊 스터디 실시간</span>
        <div className="flex gap-3 font-mono text-[10px]">
          <span>전체 {data.total}</span>
          <span className="text-ink">완주 {data.done}</span>
          <span className="text-rust">활동 {data.active}</span>
          <span className="text-muted">막힘 {data.stuck}</span>
        </div>
      </div>
      <div className={`overflow-y-auto ${compact ? 'max-h-[280px]' : 'max-h-[480px]'}`}>
        <table className="w-full text-xs">
          <thead className="font-mono text-[10px] text-muted">
            <tr className="border-b border-ink">
              <th className="text-left py-1">이름</th>
              <th className="text-left py-1">빙고</th>
              <th className="text-left py-1">마지막 활동</th>
              <th className="text-left py-1">상태</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const bar = '█'.repeat(r.bingoDone) + '░'.repeat(9 - r.bingoDone);
              const status = r.stuck
                ? '🟡 막힘'
                : r.lastActivityMinsAgo !== null && r.lastActivityMinsAgo < 5
                  ? '🟢 활동중'
                  : r.bingoDone === 9
                    ? '🏁 완주'
                    : r.bingoDone > 0
                      ? '⏸ 일시정지'
                      : '⚪ 미시작';
              return (
                <tr key={r.name} className="border-b border-ink/10 hover:bg-sand/50">
                  <td className="py-1 font-display">
                    {r.displayName ?? r.name}
                    {!r.telegramConnected && (
                      <span className="ml-1 text-[9px] text-rust">[텔레그램 미등록]</span>
                    )}
                  </td>
                  <td className="py-1 font-mono">
                    <span className="text-[10px]">{bar}</span> {r.bingoDone}/9
                  </td>
                  <td className="py-1 font-mono text-[10px] text-muted">
                    {r.lastActivityMinsAgo === null
                      ? '—'
                      : r.lastActivityMinsAgo === 0
                        ? '방금'
                        : `${r.lastActivityMinsAgo}분 전`}
                  </td>
                  <td className="py-1 font-mono text-[10px]">{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="font-mono text-[9px] text-muted mt-1">15초마다 자동 갱신</div>
    </div>
  );
}

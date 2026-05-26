'use client';
import { useEffect, useRef, useState } from 'react';

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
  const [changedRows, setChangedRows] = useState<Set<string>>(new Set());
  const prevRef = useRef<Map<string, AgentRow>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () =>
      fetch('/api/runtime/bingo/all')
        .then((r) => r.json())
        .then((d: MonitorResponse) => {
          if (cancelled) return;
          // 변경된 row 감지 → pulse 효과
          const changed = new Set<string>();
          for (const row of d.rows) {
            const prev = prevRef.current.get(row.name);
            if (prev && (prev.bingoDone !== row.bingoDone || prev.lastActivityMinsAgo !== row.lastActivityMinsAgo)) {
              changed.add(row.name);
            }
            prevRef.current.set(row.name, row);
          }
          if (changed.size > 0) {
            setChangedRows(changed);
            setTimeout(() => setChangedRows(new Set()), 900);
          }
          setData(d);
          setLoading(false);
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
    return <div className="brut p-3 font-mono text-xs text-muted">모니터링 불러오는 중…</div>;
  }
  if (!data) {
    return <div className="brut p-3 font-mono text-xs text-rust">데이터를 불러오지 못했어요.</div>;
  }

  return (
    <div className="brut p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-bold text-sm">📊 16명 실시간</span>
        <div className="flex gap-3 font-mono text-[10px]">
          <Stat label="전체" value={data.total} />
          <Stat label="완주" value={data.done} accent />
          <Stat label="활동" value={data.active} pulse />
          <Stat label="막힘" value={data.stuck} muted />
        </div>
      </div>
      <div className={`overflow-y-auto ${compact ? 'max-h-[280px]' : 'max-h-[480px]'}`}>
        <table className="w-full text-xs">
          <thead className="font-mono text-[10px] text-muted sticky top-0 bg-paper">
            <tr className="border-b-2 border-line">
              <th className="text-left py-1.5">이름</th>
              <th className="text-left py-1.5">진행</th>
              <th className="text-left py-1.5">마지막</th>
              <th className="text-left py-1.5">상태</th>
            </tr>
          </thead>
          <tbody className="stagger">
            {data.rows.map((r) => {
              const status = r.stuck
                ? '🟡 막힘'
                : r.lastActivityMinsAgo !== null && r.lastActivityMinsAgo < 5
                  ? '🟢 활동중'
                  : r.bingoDone === 9
                    ? '🏁 완주'
                    : r.bingoDone > 0
                      ? '⏸ 일시정지'
                      : '⚪ 미시작';
              const isChanged = changedRows.has(r.name);
              return (
                <tr key={r.name} className={`border-b border-line/15 ${isChanged ? 'row-pulse' : ''}`}>
                  <td className="py-1 font-display">
                    {r.displayName ?? r.name}
                    {!r.telegramConnected && (
                      <span className="ml-1 text-[9px] text-rust">[텔레그램 미등록]</span>
                    )}
                  </td>
                  <td className="py-1">
                    <div className="flex gap-0.5 items-center">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <span
                          key={i}
                          className="w-1.5 h-2.5"
                          style={{
                            background:
                              i < r.bingoDone
                                ? 'var(--th-accent)'
                                : 'color-mix(in srgb, var(--th-fg) 10%, transparent)',
                            borderRadius: 1,
                          }}
                        />
                      ))}
                      <span className="font-mono text-[10px] text-muted ml-1.5">
                        {r.bingoDone}/9
                      </span>
                    </div>
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
      <div className="font-mono text-[9px] text-muted mt-2 text-right">15초마다 자동 갱신</div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  pulse,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  pulse?: boolean;
  muted?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <span
        className={`font-display font-extrabold ${
          accent ? 'text-rust' : muted ? 'text-muted' : ''
        } ${pulse && value > 0 ? 'animate-pulse' : ''}`}
        style={{ fontSize: '13px' }}
      >
        {value}
      </span>
    </span>
  );
}

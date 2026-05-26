'use client';
import { useEffect, useState } from 'react';

interface Entry {
  rank: number;
  name: string;
  displayName: string | null;
  done: number;
}

export function Leaderboard() {
  const [data, setData] = useState<Entry[]>([]);
  useEffect(() => {
    fetch('/api/runtime/week2/leaderboard')
      .then((r) => r.json())
      .then((d: { rankings: Entry[] }) => setData(d.rankings ?? []))
      .catch(() => {});
  }, []);

  const top = data.slice(0, 5);
  return (
    <div className="brut p-4">
      <div className="font-display font-bold text-sm mb-3">🏆 빙고 leaderboard</div>
      <ol className="space-y-3 stagger">
        {top.map((e) => {
          const medal =
            e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `${e.rank}.`;
          return (
            <li key={e.name} className="flex items-center gap-3">
              <span className="w-7 text-center font-display font-bold text-sm">{medal}</span>
              <span className="w-24 truncate font-mono text-sm">
                {e.displayName ?? e.name}
              </span>
              <div className="flex-1 flex gap-1" aria-hidden>
                {Array.from({ length: 9 }).map((_, i) => (
                  <span
                    key={i}
                    className="flex-1 h-3 border border-line/30"
                    style={{
                      background:
                        i < e.done ? 'var(--th-accent)' : 'color-mix(in srgb, var(--th-fg) 8%, transparent)',
                      borderRadius: 1,
                    }}
                  />
                ))}
              </div>
              <span className="font-mono text-xs text-muted w-10 text-right">{e.done}/9</span>
            </li>
          );
        })}
        {top.length === 0 && (
          <li className="font-mono text-xs text-muted">아직 데이터 없음</li>
        )}
      </ol>
    </div>
  );
}

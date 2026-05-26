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
    <div className="brut p-4 bg-paper">
      <div className="font-display font-bold text-sm mb-3">🏆 빙고 leaderboard</div>
      <ol className="space-y-2">
        {top.map((e) => {
          const medal =
            e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `${e.rank}.`;
          return (
            <li key={e.name} className="flex items-center gap-3">
              <span className="w-8 text-center font-display font-bold">{medal}</span>
              <span className="flex-1 truncate font-mono text-sm">
                {e.displayName ?? e.name}
              </span>
              <span className="font-mono text-xs">
                {'█'.repeat(e.done)}
                {'░'.repeat(9 - e.done)}
              </span>
              <span className="font-mono text-xs text-muted">{e.done}/9</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

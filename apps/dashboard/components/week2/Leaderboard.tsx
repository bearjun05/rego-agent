'use client';
import { useEffect, useState } from 'react';
import { CompletionBadge } from '../CompletionBadge';

interface Entry {
  rank: number;
  name: string;
  displayName: string | null;
  done: number;
  /** 라인 수 (서버가 안 주면 클라이언트에서 cells로 계산 — 일단 done 만 사용) */
  lines?: number;
}

function medalGlyph(rank: number): string {
  if (rank === 1) return '👑';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
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
      <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-ink/15">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Leaderboard</div>
          <div className="font-display font-bold text-base">빙고 순위</div>
        </div>
      </div>
      <ol className="space-y-3 stagger">
        {top.map((e) => {
          const isComplete = e.done === 9;
          return (
            <li key={e.name} className="flex items-center gap-3">
              <span className="w-7 text-center font-display font-bold text-base leading-none">
                {e.rank <= 3 ? medalGlyph(e.rank) : <span className="font-mono text-muted">{e.rank}</span>}
              </span>
              <span className="w-28 truncate font-mono text-sm flex items-center gap-1.5">
                <span className="truncate">{e.displayName ?? e.name}</span>
                {isComplete && <CompletionBadge size="sm" />}
              </span>
              <div className="flex-1 flex gap-1" aria-hidden>
                {Array.from({ length: 9 }).map((_, i) => (
                  <span
                    key={i}
                    className="flex-1 h-3 border border-line/30"
                    style={{
                      background:
                        i < e.done
                          ? isComplete
                            ? 'var(--th-primary-2)'
                            : 'var(--th-accent)'
                          : 'color-mix(in srgb, var(--th-fg) 8%, transparent)',
                      borderRadius: 1,
                    }}
                  />
                ))}
              </div>
              {isComplete ? (
                <span
                  className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border-2 border-ink w-16 text-center"
                  style={{ background: 'var(--th-primary-2)', color: 'var(--th-fg)' }}
                >
                  완성
                </span>
              ) : (
                <span className="font-mono text-xs text-muted w-16 text-right tabular-nums">
                  {e.done}/9
                </span>
              )}
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

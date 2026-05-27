'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BingoBoard, type CellDef, type CellStatus } from './BingoBoard';
import { CompletionBadge, countBingoLines, type CellMap } from './CompletionBadge';

interface RankRow {
  name: string;
  displayName: string | null;
  bingoDone: number;
  bingoCells?: CellMap; // { "1": "done", "2": "pending", ... }
}

/**
 * 채팅 우측 패널 — 빙고판 + 실시간 순위 (자연 길이, gap-3 으로 붙임).
 */
export function BingoSidePanel({
  agentSlug,
  onCellExplain,
  refreshKey = 0,
}: {
  agentSlug: string;
  onCellExplain: (cell: CellDef, status: CellStatus) => void;
  refreshKey?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <BingoBoard
        agentSlug={agentSlug}
        onCellClick={onCellExplain}
        refreshKey={refreshKey}
      />
      <MiniLeaderboard agentSlug={agentSlug} />
    </div>
  );
}

function medal(rank: number): string {
  if (rank === 1) return '👑';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

function MiniLeaderboard({ agentSlug }: { agentSlug: string }) {
  const [rows, setRows] = useState<RankRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () =>
      fetch('/api/runtime/bingo/all')
        .then((r) => r.json())
        .then((d: { rows: RankRow[] }) => {
          if (!cancelled) setRows(d.rows ?? []);
        })
        .catch(() => {});
    fetchOnce();
    const i = setInterval(fetchOnce, 15_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  // 정렬: 라인 수 우선 → 칸 수 보조 (라인이 같으면 칸 많은 사람이 앞)
  const enriched = rows.map((r) => ({
    ...r,
    lines: r.bingoCells ? countBingoLines(r.bingoCells) : 0,
  }));
  const sorted = [...enriched].sort((a, b) => {
    if (b.lines !== a.lines) return b.lines - a.lines;
    return b.bingoDone - a.bingoDone;
  });
  const myIdx = sorted.findIndex((r) => r.name === agentSlug);

  return (
    <Link
      href="/week2"
      className="brut p-4 hover:bg-sand transition-colors flex flex-col gap-2"
      title="클릭 → 16명 진행률 전체 대시보드"
    >
      <div className="flex items-center justify-between pb-2 border-b border-ink/15">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Ranking</div>
          <div className="font-display font-bold text-base leading-tight">실시간 순위 ({sorted.length}명)</div>
        </div>
        <span className="font-mono text-[10px] text-muted">
          {myIdx >= 0 ? `내 ${myIdx + 1}위` : '—'} · 전체 →
        </span>
      </div>
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
        {sorted.map((r, i) => {
          const isMe = r.name === agentSlug;
          const isComplete = r.bingoDone === 9;
          const rank = i + 1;
          return (
            <div
              key={r.name}
              className={`flex items-center gap-2 text-[13px] ${isMe ? 'font-bold' : ''}`}
            >
              <span className="w-6 text-center font-display tabular-nums leading-none" style={{ fontSize: rank <= 3 ? 16 : 13 }}>
                {rank <= 3 ? medal(rank) : <span className="text-muted font-mono">{rank}</span>}
              </span>
              <span className={`flex-1 truncate flex items-center gap-1.5 ${isMe ? 'text-rust' : ''}`}>
                <span className="truncate">
                  {r.displayName ?? r.name}
                  {isMe && ' (나)'}
                </span>
                {isComplete && <CompletionBadge size="sm" />}
              </span>
              {isComplete ? (
                <span
                  className="font-mono text-[10px] font-bold tabular-nums px-1.5 py-0.5 border-2 border-ink"
                  style={{ background: 'var(--th-primary-2)', color: 'var(--th-fg)' }}
                >
                  완성
                </span>
              ) : (
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  <span className="font-bold text-ink">{r.lines}</span>빙고 · {r.bingoDone}/9칸
                </span>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div className="font-mono text-[10px] text-muted">데이터 없음</div>
        )}
      </div>
    </Link>
  );
}

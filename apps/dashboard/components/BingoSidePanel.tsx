'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BingoBoard, type CellDef, type CellStatus } from './BingoBoard';

interface RankRow {
  name: string;
  displayName: string | null;
  bingoDone: number;
}

/**
 * 채팅 오른쪽 1/3에 들어가는 사이드 패널.
 * - 상단 2/3: 빙고판 (셀 호버 → 짧은 설명 / 클릭 → 인솔이 채팅에 설명)
 * - 하단 1/3: 실시간 순위판 미니 (클릭 → /week2 페이지)
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

  const sorted = [...rows].sort((a, b) => b.bingoDone - a.bingoDone);
  const myIdx = sorted.findIndex((r) => r.name === agentSlug);
  const top = sorted.slice(0, 5);

  return (
    <Link
      href="/week2"
      className="brut p-3 hover:bg-sand transition-colors flex flex-col gap-1.5"
      title="클릭 → 16명 진행률 전체 대시보드"
    >
      <div className="flex items-center justify-between pb-1.5 border-b border-ink/15">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">실시간 순위</span>
        <span className="font-mono text-[9px] text-muted">
          {myIdx >= 0 ? `${myIdx + 1}위` : '—'} · 전체 →
        </span>
      </div>
      <div className="space-y-1">
        {top.map((r, i) => {
          const isMe = r.name === agentSlug;
          return (
            <div
              key={r.name}
              className={`flex items-center gap-2 text-[11px] ${isMe ? 'font-bold' : ''}`}
            >
              <span
                className="w-5 text-center font-mono tabular-nums"
                style={{ color: i < 3 ? 'var(--th-accent)' : 'var(--th-muted)' }}
              >
                {i + 1}
              </span>
              <span className={`flex-1 truncate ${isMe ? 'text-rust' : ''}`}>
                {r.displayName ?? r.name}
                {isMe && ' (나)'}
              </span>
              <span className="font-mono text-muted tabular-nums">{r.bingoDone}/9</span>
            </div>
          );
        })}
        {top.length === 0 && (
          <div className="font-mono text-[10px] text-muted">데이터 없음</div>
        )}
      </div>
    </Link>
  );
}

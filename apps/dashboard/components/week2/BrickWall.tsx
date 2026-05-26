'use client';
import { useEffect, useState } from 'react';

interface AgentRow {
  name: string;
  displayName: string | null;
  bingoDone: number;
}

/**
 * 16명 진행률을 큰 brick wall로 시각화 — 가로 8 × 세로 2 그리드,
 * 각 brick의 채워진 비율(빙고 진행)이 색으로 표현됨.
 * 호버 시 학습자 이름 + 진행 표시.
 */
export function BrickWall() {
  const [data, setData] = useState<AgentRow[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () =>
      fetch('/api/runtime/bingo/all')
        .then((r) => r.json())
        .then((d: { rows: AgentRow[] }) => {
          if (!cancelled) setData(d.rows ?? []);
        })
        .catch(() => {});
    fetchOnce();
    const i = setInterval(fetchOnce, 15_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  // 정렬: 진행률 높은 순 + 이름순
  const sorted = [...data].sort((a, b) =>
    b.bingoDone !== a.bingoDone
      ? b.bingoDone - a.bingoDone
      : (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name),
  );

  const hoveredAgent = sorted.find((a) => a.name === hovered);

  return (
    <div className="brut p-4 stud">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-bold text-sm">🧱 16명 brick wall</span>
        <span className="font-mono text-[10px] text-muted">
          {hoveredAgent
            ? `${hoveredAgent.displayName ?? hoveredAgent.name} · ${hoveredAgent.bingoDone}/9`
            : '호버로 보기'}
        </span>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {sorted.map((r) => (
          <Brick
            key={r.name}
            row={r}
            onHover={() => setHovered(r.name)}
            onLeave={() => setHovered(null)}
          />
        ))}
      </div>
    </div>
  );
}

function Brick({
  row,
  onHover,
  onLeave,
}: {
  row: AgentRow;
  onHover: () => void;
  onLeave: () => void;
}) {
  const pct = row.bingoDone / 9;
  const isFinished = row.bingoDone === 9;
  // 색 — 진행도 따라 muted → accent
  return (
    <div
      className="relative aspect-[2/1] overflow-hidden border-2 border-line cursor-pointer transition-transform hover:scale-110 hover:z-10"
      style={{
        background: 'color-mix(in srgb, var(--th-fg) 8%, transparent)',
        borderRadius: 'var(--th-card-radius, 0)',
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={`${row.displayName ?? row.name} · ${row.bingoDone}/9`}
    >
      {/* fill bar */}
      <div
        className="absolute inset-0 transition-all duration-700"
        style={{
          background: isFinished
            ? 'var(--th-accent)'
            : `linear-gradient(90deg, var(--th-accent) ${pct * 100}%, transparent ${pct * 100}%)`,
          opacity: isFinished ? 1 : 0.85,
        }}
      />
      {/* stud */}
      <span
        aria-hidden
        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
        style={{ background: isFinished ? 'var(--th-bg)' : 'var(--th-fg)', opacity: 0.5 }}
      />
      {/* 이름 (small) */}
      <span
        className="absolute bottom-1 left-1 font-mono text-[8px] truncate max-w-[calc(100%-12px)]"
        style={{ color: isFinished ? 'var(--th-bg)' : 'var(--th-fg)' }}
      >
        {(row.displayName ?? row.name).slice(0, 6)}
      </span>
      {/* 진행 숫자 */}
      <span
        className="absolute top-0.5 left-1 font-display font-extrabold"
        style={{
          color: isFinished ? 'var(--th-bg)' : 'var(--th-fg)',
          opacity: 0.85,
          fontSize: '11px',
        }}
      >
        {row.bingoDone}
      </span>
    </div>
  );
}

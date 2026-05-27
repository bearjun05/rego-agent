'use client';
import { useEffect, useState } from 'react';
import { countBingoLines, type CellMap } from '../CompletionBadge';

interface AgentRow {
  name: string;
  displayName: string | null;
  bingoDone: number;
  bingoCells?: CellMap;
}

/**
 * 16명 빙고 현황 — 각자 3x3 미니 빙고판 + 완성된 라인을 SVG 선으로 추상 표현.
 * 사용자가 어떤 라인(가로/세로/대각)을 완성했는지 한눈에.
 */
export function BrickWall() {
  const [data, setData] = useState<AgentRow[]>([]);

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

  // 정렬: 라인 수 → 칸 수 → 이름
  const enriched = data.map((r) => ({
    ...r,
    lines: r.bingoCells ? countBingoLines(r.bingoCells) : 0,
  }));
  const sorted = [...enriched].sort((a, b) => {
    if (b.lines !== a.lines) return b.lines - a.lines;
    if (b.bingoDone !== a.bingoDone) return b.bingoDone - a.bingoDone;
    return (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name);
  });

  return (
    <div className="brut p-4">
      <div className="flex items-end justify-between mb-3 pb-2 border-b border-ink/15">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Status</div>
          <div className="font-display font-bold text-base">빙고 현황</div>
        </div>
        <span className="font-mono text-[10px] text-muted">16명 · 15초마다 갱신</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {sorted.map((r) => (
          <MiniBingo key={r.name} row={r} />
        ))}
      </div>
    </div>
  );
}

// 3x3 셀 위치 (id 1~9):
//   1 2 3
//   4 5 6
//   7 8 9
// 각 셀의 중심 좌표 (viewBox 100x100)
const CELL_CENTER: Record<number, [number, number]> = {
  1: [16, 16], 2: [50, 16], 3: [84, 16],
  4: [16, 50], 5: [50, 50], 6: [84, 50],
  7: [16, 84], 8: [50, 84], 9: [84, 84],
};

const LINES: Array<{ ids: number[]; from: number; to: number }> = [
  // 가로
  { ids: [1, 2, 3], from: 1, to: 3 },
  { ids: [4, 5, 6], from: 4, to: 6 },
  { ids: [7, 8, 9], from: 7, to: 9 },
  // 세로
  { ids: [1, 4, 7], from: 1, to: 7 },
  { ids: [2, 5, 8], from: 2, to: 8 },
  { ids: [3, 6, 9], from: 3, to: 9 },
  // 대각
  { ids: [1, 5, 9], from: 1, to: 9 },
  { ids: [3, 5, 7], from: 3, to: 7 },
];

function completedLines(cells: CellMap | undefined): typeof LINES {
  if (!cells) return [];
  return LINES.filter((l) => l.ids.every((id) => cells[String(id)] === 'done'));
}

function MiniBingo({
  row,
}: {
  row: AgentRow & { lines: number };
}) {
  const cells = row.bingoCells;
  const isFinished = row.bingoDone === 9;
  const lines = completedLines(cells);

  return (
    <div
      className={`relative border-2 p-2 transition-transform hover:scale-105 hover:z-10 ${
        isFinished ? 'border-ink' : 'border-line'
      }`}
      style={{
        background: isFinished
          ? 'color-mix(in srgb, var(--th-primary-2) 22%, var(--th-card-bg))'
          : 'var(--th-card-bg)',
        borderRadius: 'var(--th-card-radius, 0)',
      }}
      title={`${row.displayName ?? row.name} · ${row.lines}빙고 · ${row.bingoDone}/9칸`}
    >
      <div className="font-display font-bold text-[11px] leading-tight truncate mb-1.5">
        {row.displayName ?? row.name}
      </div>

      {/* 3x3 미니 보드 + 라인 overlay */}
      <div className="relative w-full" style={{ aspectRatio: '1 / 1' }}>
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-[2px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => {
            const done = cells?.[String(id)] === 'done';
            return (
              <div
                key={id}
                className="border border-ink/20"
                style={{
                  background: done ? 'var(--th-accent)' : 'color-mix(in srgb, var(--th-fg) 6%, transparent)',
                  borderRadius: 1,
                }}
              />
            );
          })}
        </div>
        {/* 완성된 라인 SVG overlay */}
        {lines.length > 0 && (
          <svg
            className="absolute inset-0 pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {lines.map((l, i) => {
              const [x1, y1] = CELL_CENTER[l.from]!;
              const [x2, y2] = CELL_CENTER[l.to]!;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isFinished ? 'var(--th-fg)' : 'var(--th-primary-2)'}
                  strokeWidth={isFinished ? 6 : 5}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              );
            })}
          </svg>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between font-mono text-[10px]">
        <span className="font-display font-bold text-ink tabular-nums">
          {row.lines}<span className="text-muted font-normal text-[9px] ml-0.5">빙고</span>
        </span>
        <span className="text-muted tabular-nums">
          {row.bingoDone}<span className="text-[9px] ml-0.5">/9칸</span>
        </span>
      </div>
    </div>
  );
}

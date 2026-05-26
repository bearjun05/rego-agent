'use client';
import { useEffect, useState } from 'react';

export type CellId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type CellStatus = 'done' | 'pending';

export interface CellDef {
  id: CellId;
  title: string;
  short: string;
  description: string;
  hint: string;
  method: 'db' | 'tool_log' | 'llm_review' | 'chat_input';
}

interface BingoStatusResponse {
  agent: string;
  cells: Record<CellId, CellStatus>;
  defs: CellDef[];
}

export function BingoBoard({
  agentSlug,
  onCellClick,
  refreshKey = 0,
}: {
  agentSlug: string;
  onCellClick: (cell: CellDef, status: CellStatus) => void;
  /** 외부에서 상태 재조회를 트리거하려면 키 변경 */
  refreshKey?: number;
}) {
  const [data, setData] = useState<BingoStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/runtime/bingo/status?agent=${encodeURIComponent(agentSlug)}`)
      .then((r) => r.json())
      .then((d: BingoStatusResponse) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentSlug, refreshKey]);

  if (loading && !data) {
    return (
      <div className="brut p-3 bg-paper font-mono text-xs text-muted">
        빙고판 불러오는 중...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="brut p-3 bg-paper font-mono text-xs text-rust">
        빙고판을 불러오지 못했어요.
      </div>
    );
  }

  const doneCount = Object.values(data.cells).filter((s) => s === 'done').length;

  return (
    <div className="brut p-3 bg-paper">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display font-bold text-sm">🎯 빙고판</span>
        <span className="font-mono text-[10px] text-muted">{doneCount}/9 완료</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {data.defs.map((def) => {
          const status = data.cells[def.id];
          const done = status === 'done';
          return (
            <button
              key={def.id}
              onClick={() => onCellClick(def, status)}
              className={`aspect-square p-2 border-2 border-ink text-left transition-colors hover:bg-sand ${
                done ? 'bg-ink text-paper' : 'bg-paper'
              }`}
            >
              <div className="font-mono text-[10px] opacity-70 mb-0.5">
                {def.id}. {done ? '✓' : '○'}
              </div>
              <div className="font-display font-bold text-[11px] leading-tight">
                {def.short}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

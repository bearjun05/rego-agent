'use client';
import { useEffect, useRef, useState } from 'react';

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
  refreshKey?: number;
}) {
  const [data, setData] = useState<BingoStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [poppedCell, setPoppedCell] = useState<CellId | null>(null);
  const prevDoneRef = useRef<Set<CellId>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/runtime/bingo/status?agent=${encodeURIComponent(agentSlug)}`)
      .then((r) => r.json())
      .then((d: BingoStatusResponse) => {
        if (cancelled) return;
        // 새로 done된 셀 = confetti / 강조
        const nowDone = new Set<CellId>();
        for (const [k, v] of Object.entries(d.cells)) {
          if (v === 'done') nowDone.add(Number(k) as CellId);
        }
        // 최초 로드 아니면 새로 done된 셀 pop
        if (prevDoneRef.current.size > 0) {
          for (const id of nowDone) {
            if (!prevDoneRef.current.has(id)) {
              setPoppedCell(id);
              setTimeout(() => setPoppedCell(null), 800);
            }
          }
        }
        prevDoneRef.current = nowDone;
        setData(d);
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
      <div className="brut p-3 font-mono text-xs text-muted">빙고판 불러오는 중…</div>
    );
  }
  if (!data) {
    return (
      <div className="brut p-3 font-mono text-xs text-rust">빙고판을 불러오지 못했어요.</div>
    );
  }

  const doneCount = Object.values(data.cells).filter((s) => s === 'done').length;

  return (
    <div className="brut p-4">
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-ink/15">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Bingo</div>
          <div className="font-display font-bold text-base leading-tight">9칸 미션</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="brick-row" aria-hidden>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <span
                key={n}
                className={`brick-stud ${n <= doneCount ? 'brick-stud-on' : ''}`}
                style={{ width: 12, height: 12 }}
              />
            ))}
          </div>
          <span className="font-mono text-xs text-muted tabular-nums">{doneCount}/9</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 stagger">
        {data.defs.map((def) => {
          const status = data.cells[def.id];
          const done = status === 'done';
          const isPopping = poppedCell === def.id;
          return (
            <button
              key={def.id}
              onClick={(e) => {
                const el = e.currentTarget;
                el.classList.add('cell-pop');
                setTimeout(() => el.classList.remove('cell-pop'), 220);
                onCellClick(def, status);
              }}
              className={`bingo-cell aspect-square p-2.5 border-brick border-line text-left relative overflow-hidden flex flex-col justify-between ${
                done ? 'bg-warm text-paper brick' : 'bg-paper hover:bg-sand'
              } ${isPopping ? 'snap-in' : ''}`}
              style={{ borderRadius: 'var(--th-card-radius, 0)' }}
            >
              <span
                aria-hidden
                className="absolute top-2 right-2 rounded-full"
                style={{
                  width: 10,
                  height: 10,
                  background: done ? 'var(--th-bg)' : 'color-mix(in srgb, var(--th-fg) 18%, transparent)',
                }}
              />
              {isPopping && <Confetti />}
              <div
                className="font-display font-extrabold tabular-nums leading-none"
                style={{ fontSize: 28, opacity: done ? 0.6 : 0.38 }}
              >
                {String(def.id).padStart(2, '0')}
              </div>
              <div className="font-display font-bold text-[13px] leading-tight">
                {def.short}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Confetti() {
  // 4개 작은 점이 다른 방향으로 튀어나감
  return (
    <>
      <span className="confetti-dot" style={{ background: 'var(--th-accent)', ['--cx' as any]: '-18px', ['--cy' as any]: '-18px', top: '50%', left: '50%' } as React.CSSProperties} />
      <span className="confetti-dot" style={{ background: 'var(--th-primary-2)', ['--cx' as any]: '18px', ['--cy' as any]: '-18px', top: '50%', left: '50%' } as React.CSSProperties} />
      <span className="confetti-dot" style={{ background: 'var(--th-primary-1)', ['--cx' as any]: '-18px', ['--cy' as any]: '18px', top: '50%', left: '50%' } as React.CSSProperties} />
      <span className="confetti-dot" style={{ background: 'var(--th-primary-4)', ['--cx' as any]: '18px', ['--cy' as any]: '18px', top: '50%', left: '50%' } as React.CSSProperties} />
    </>
  );
}

'use client';
import { useEffect, useState } from 'react';

interface CellRate {
  id: number;
  title: string;
  short: string;
  done: number;
  total: number;
  rate: number;
}

export function CellClearRates() {
  const [data, setData] = useState<CellRate[]>([]);
  useEffect(() => {
    fetch('/api/runtime/week2/cell-clear-rates')
      .then((r) => r.json())
      .then((d: { cells: CellRate[] }) => setData(d.cells ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="brut p-4 bg-paper">
      <div className="font-display font-bold text-sm mb-3">📊 셀별 클리어율</div>
      <div className="grid grid-cols-3 gap-2">
        {data.map((c) => {
          const pct = Math.round(c.rate * 100);
          return (
            <div key={c.id} className="brut p-2 bg-sand text-center">
              <div className="font-mono text-[10px] text-muted">셀 {c.id}</div>
              <div className="font-display font-bold text-xs leading-tight my-1">
                {c.short}
              </div>
              <div className="font-display font-extrabold text-2xl">{pct}%</div>
              <div className="font-mono text-[10px] text-muted">
                {c.done}/{c.total}명
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

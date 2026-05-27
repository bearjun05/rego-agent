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
    <div className="brut p-4">
      <div className="font-display font-bold text-sm mb-4">📊 빙고별 클리어율</div>
      <div className="grid grid-cols-9 gap-2 h-40">
        {data.map((c) => {
          const fillCount = Math.round(c.rate * 10);
          return (
            <div key={c.id} className="flex flex-col items-center justify-end gap-2">
              <div className="brick-tower w-full flex-1 max-h-32">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className={`brick-tower-cell ${i < fillCount ? 'fill' : ''}`}
                  />
                ))}
              </div>
              <div className="text-center">
                <div className="font-display font-extrabold text-sm leading-none">
                  {Math.round(c.rate * 100)}%
                </div>
                <div className="font-mono text-[9px] text-muted mt-0.5">{c.id}번</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="font-mono text-[10px] text-muted text-center mt-3">
        16명 중 몇 명이 각 빙고 한 칸을 클리어했나
      </div>
    </div>
  );
}

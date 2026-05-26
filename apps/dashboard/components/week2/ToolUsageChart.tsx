'use client';
import { useEffect, useState } from 'react';

interface Tool {
  id: string;
  total: number;
  uniqueUsers: number;
}

export function ToolUsageChart() {
  const [data, setData] = useState<Tool[]>([]);
  useEffect(() => {
    fetch('/api/runtime/week2/tool-usage')
      .then((r) => r.json())
      .then((d: { tools: Tool[] }) => setData(d.tools ?? []))
      .catch(() => {});
  }, []);

  const max = data[0]?.total ?? 1;
  const top = data.slice(0, 8);

  return (
    <div className="brut p-4 bg-paper">
      <div className="font-display font-bold text-sm mb-3">🔧 도구 사용 빈도</div>
      <ul className="space-y-2">
        {top.map((t) => {
          const pct = (t.total / max) * 100;
          return (
            <li key={t.id} className="text-xs">
              <div className="flex justify-between mb-0.5">
                <span className="font-mono truncate">{t.id}</span>
                <span className="font-mono text-muted">
                  {t.total}회 · {t.uniqueUsers}명
                </span>
              </div>
              <div className="h-2 bg-muted/10 relative">
                <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
        {top.length === 0 && (
          <li className="font-mono text-xs text-muted">아직 도구 호출 없음</li>
        )}
      </ul>
    </div>
  );
}

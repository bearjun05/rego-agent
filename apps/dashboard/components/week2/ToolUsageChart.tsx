'use client';
import { useEffect, useState } from 'react';

interface Tool {
  id: string;
  total: number;
  uniqueUsers: number;
}

function categoryColor(id: string): string {
  if (id.startsWith('slack.')) return 'var(--th-primary-1)'; // 트리거 톤
  if (id.startsWith('telegram.')) return 'var(--th-primary-4)'; // 상태 톤
  if (id.startsWith('llm.')) return 'var(--th-primary-3)'; // 규칙 톤
  return 'var(--th-primary-2)';
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
  const top = data.slice(0, 10);

  return (
    <div className="brut p-4">
      <div className="font-display font-bold text-sm mb-3">🔧 도구 사용 빈도</div>
      <ul className="space-y-2 stagger">
        {top.map((t) => {
          const pct = (t.total / max) * 100;
          const color = categoryColor(t.id);
          return (
            <li key={t.id} className="text-xs">
              <div className="flex justify-between mb-0.5">
                <span className="font-mono truncate">{t.id}</span>
                <span className="font-mono text-muted">
                  {t.total}회 · {t.uniqueUsers}명
                </span>
              </div>
              <div className="h-3 relative" style={{ background: 'color-mix(in srgb, var(--th-fg) 8%, transparent)' }}>
                <div
                  className="h-full transition-all"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
            </li>
          );
        })}
        {top.length === 0 && (
          <li className="font-mono text-xs text-muted">아직 도구 호출 없음</li>
        )}
      </ul>
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-line/20 font-mono text-[10px]">
        <Legend color="var(--th-primary-1)" label="slack.*" />
        <Legend color="var(--th-primary-4)" label="telegram.*" />
        <Legend color="var(--th-primary-3)" label="llm.*" />
        <Legend color="var(--th-primary-2)" label="기타" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-2.5" style={{ background: color }} />
      {label}
    </span>
  );
}

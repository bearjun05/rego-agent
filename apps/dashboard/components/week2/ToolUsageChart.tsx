'use client';
import { useEffect, useState } from 'react';
import { toolLabel, toolCategoryColor, toolCategoryKo, type ToolCategory } from '@/lib/tool-labels';

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
  const top = data.slice(0, 10);
  const categories: ToolCategory[] = ['slack', 'telegram', 'llm', 'calendar', 'github', 'other'];
  const usedCats = new Set(top.map((t) => toolLabel(t.id).category));

  return (
    <div className="brut p-4">
      <div className="mb-3 pb-2 border-b border-ink/15">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Tools</div>
        <div className="font-display font-bold text-base">어떤 도구를 많이 쓰나</div>
      </div>
      <ul className="space-y-2 stagger">
        {top.map((t) => {
          const meta = toolLabel(t.id);
          const pct = (t.total / max) * 100;
          const color = toolCategoryColor(meta.category);
          return (
            <li key={t.id} className="text-[13px]" title={meta.hint ?? t.id}>
              <div className="flex justify-between mb-0.5 items-baseline gap-2">
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="font-display font-bold truncate">{meta.label}</span>
                  <span className="font-mono text-[10px] text-muted truncate">{t.id}</span>
                </span>
                <span className="font-mono text-[11px] text-muted shrink-0 tabular-nums">
                  {t.total}회 · {t.uniqueUsers}명
                </span>
              </div>
              <div
                className="h-3 relative"
                style={{ background: 'color-mix(in srgb, var(--th-fg) 8%, transparent)' }}
              >
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
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-ink/15 font-mono text-[10px]">
        {categories
          .filter((c) => usedCats.has(c))
          .map((c) => (
            <Legend key={c} color={toolCategoryColor(c)} label={toolCategoryKo(c)} />
          ))}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5" style={{ background: color }} />
      {label}
    </span>
  );
}

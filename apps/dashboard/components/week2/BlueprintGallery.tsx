'use client';
import { useEffect, useState } from 'react';
import { AgentBlueprint } from '../AgentBlueprint';
import { toolLabel } from '@/lib/tool-labels';

interface Blueprint {
  agent: string;
  displayName: string | null;
  triggers: string[];
  tools: string[];
  hasOnCron: boolean;
  hasOnTelegramCallback: boolean;
  handlerLines: number;
  effectiveLines: number;
  templateLines: number;
  stats: { runs: number; toolCalls: number; telegramSent: number; llmCost: number };
}

export function BlueprintGallery() {
  const [data, setData] = useState<Blueprint[]>([]);
  const [selected, setSelected] = useState<Blueprint | null>(null);

  useEffect(() => {
    fetch('/api/runtime/week2/blueprints')
      .then((r) => r.json())
      .then((d: { blueprints: Blueprint[] }) => setData(d.blueprints ?? []))
      .catch(() => {});
  }, []);

  // 정렬: 실효 라인수 많은 순 (시작 안 한 사람은 뒤로)
  const sorted = [...data].sort((a, b) => b.effectiveLines - a.effectiveLines);

  return (
    <div className="brut p-4 bg-paper">
      <div className="mb-3 pb-2 border-b border-ink/15">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Blueprint</div>
        <div className="font-display font-bold text-base">구현 현황</div>
        {!selected && (
          <div className="font-mono text-[10px] text-muted mt-0.5">
            본인이 직접 깎은 줄 수 기준. 0줄 = 아직 시작 안 함.
          </div>
        )}
      </div>
      {!selected && (
        <div className="grid md:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto">
          {sorted.slice(0, 18).map((b) => {
            const started = b.effectiveLines > 0;
            return (
              <button
                key={b.agent}
                onClick={() => setSelected(b)}
                className={`brut p-3 text-left transition-colors ${
                  started ? 'bg-sand hover:bg-paper' : 'bg-paper hover:bg-sand opacity-70'
                }`}
              >
                <div className="font-display font-bold text-sm">
                  {b.displayName ?? b.agent}
                </div>
                <div className="font-mono text-[10px] text-muted mt-1 tabular-nums">
                  {started ? (
                    <>
                      <span className="font-bold text-ink">{b.effectiveLines}줄</span> · 도구 {b.tools.length}
                      {b.triggers.length > 0 && ` · 트리거 ${b.triggers.length}`}
                    </>
                  ) : (
                    <span className="italic">아직 시작 안 함 (0줄)</span>
                  )}
                </div>
                {started && b.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {b.tools.slice(0, 3).map((id) => (
                      <span
                        key={id}
                        className="font-mono text-[9px] px-1.5 py-0.5 border border-ink/30 bg-paper truncate max-w-full"
                      >
                        {toolLabel(id).label}
                      </span>
                    ))}
                    {b.tools.length > 3 && (
                      <span className="font-mono text-[9px] text-muted">+{b.tools.length - 3}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
          {sorted.length === 0 && (
            <div className="font-mono text-xs text-muted">아직 등록된 학습자가 없어요.</div>
          )}
        </div>
      )}
      {selected && (
        <div>
          <button
            onClick={() => setSelected(null)}
            className="font-mono text-xs px-3 py-1 border-2 border-ink hover:bg-sand mb-3"
          >
            ← 갤러리로
          </button>
          <div className="brut p-3 bg-paper">
            <AgentBlueprint blueprint={selected} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-xs">
            <Stat label="내가 쓴 줄" value={selected.effectiveLines} />
            <Stat label="실행" value={selected.stats.runs} />
            <Stat label="도구 호출" value={selected.stats.toolCalls} />
            <Stat label="텔레그램" value={selected.stats.telegramSent} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="brut p-2 bg-sand text-center">
      <div className="font-display font-extrabold text-lg tabular-nums">{value}</div>
      <div className="font-mono text-[9px] uppercase text-muted">{label}</div>
    </div>
  );
}

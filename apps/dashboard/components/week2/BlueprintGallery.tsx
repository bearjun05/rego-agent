'use client';
import { useEffect, useState } from 'react';
import { AgentBlueprint } from '../AgentBlueprint';

interface Blueprint {
  agent: string;
  displayName: string | null;
  triggers: string[];
  tools: string[];
  hasOnCron: boolean;
  hasOnTelegramCallback: boolean;
  handlerLines: number;
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

  // 활동 있는(handlerLines > 0) 학습자만
  const active = data.filter((b) => b.handlerLines > 0);

  return (
    <div className="brut p-4 bg-paper">
      <div className="font-display font-bold text-sm mb-3">📐 청사진 갤러리</div>
      {!selected && (
        <div className="grid md:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto">
          {active.slice(0, 12).map((b) => (
            <button
              key={b.agent}
              onClick={() => setSelected(b)}
              className="brut p-3 bg-sand hover:bg-paper text-left transition-colors"
            >
              <div className="font-display font-bold text-sm">
                {b.displayName ?? b.agent}
              </div>
              <div className="font-mono text-[10px] text-muted mt-1">
                {b.triggers.length} 트리거 · {b.tools.length} 도구
              </div>
              <div className="font-mono text-[10px] mt-2 truncate">
                {b.tools.slice(0, 3).join(', ')}
                {b.tools.length > 3 && '…'}
              </div>
            </button>
          ))}
          {active.length === 0 && (
            <div className="font-mono text-xs text-muted">
              아직 활동중인 학습자가 없어요.
            </div>
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
            <Stat label="라인수" value={selected.handlerLines} />
            <Stat label="실행" value={selected.stats.runs} />
            <Stat label="도구호출" value={selected.stats.toolCalls} />
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
      <div className="font-display font-extrabold text-lg">{value}</div>
      <div className="font-mono text-[9px] uppercase text-muted">{label}</div>
    </div>
  );
}

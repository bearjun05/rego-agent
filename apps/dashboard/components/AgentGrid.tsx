'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtCurrency, fmtNumber } from '@/lib/utils';

interface AgentSummary {
  name: string;
  displayName: string | null;
  githubHandle: string | null;
  telegramChatId: string | null;
  icon: string;
  color: string;
  description: string | null;
  isPaused: boolean;
  loaded: boolean;
  stats: {
    today: { cost: number; llmCalls: number; runs: number };
  };
}

export function AgentGrid() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  useEffect(() => {
    const load = () =>
      fetch('/api/runtime/agents')
        .then((r) => r.json())
        .then((data: { agents?: AgentSummary[] }) => setAgents(data.agents ?? []))
        .catch(() => {});
    load();
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
  }, []);

  if (agents.length === 0) {
    return (
      <div className="brut p-8 text-center">
        <div className="font-display text-4xl mb-2">🪞</div>
        <div className="font-display font-bold text-xl mb-2">아직 등록된 에이전트가 없어요</div>
        <div className="text-sm text-muted">
          스터디원이 <code className="font-mono bg-sand px-1">pnpm run setup</code>을 실행하면
          여기 카드로 나타나요.
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {agents.map((a, i) => (
        <Link
          key={a.name}
          href={`/agents/${encodeURIComponent(a.name)}`}
          className="brut p-4 block fade-up"
          style={{ animationDelay: `${i * 40}ms`, backgroundColor: tint(a.color) }}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-3xl leading-none mb-1">{a.icon}</div>
              <div className="font-display font-bold text-lg leading-tight">
                {a.displayName ?? a.name}
              </div>
              <div className="font-mono text-[10px] uppercase text-muted mt-1">@{a.name}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {a.isPaused && (
                <span className="font-mono text-[10px] uppercase bg-rust text-paper px-1.5 py-0.5">
                  PAUSED
                </span>
              )}
              {!a.loaded && (
                <span className="font-mono text-[10px] uppercase bg-sand border border-ink px-1.5 py-0.5">
                  UNLOADED
                </span>
              )}
              {a.telegramChatId && (
                <span className="font-mono text-[10px] uppercase text-muted">📱 연결됨</span>
              )}
            </div>
          </div>

          {a.description && (
            <div className="text-xs text-muted line-clamp-2 mb-3 min-h-[2rem]">
              {a.description}
            </div>
          )}

          <div className="border-t-2 border-ink pt-2 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase">
            <div>
              <div className="text-muted">runs</div>
              <div className="text-base font-bold">{fmtNumber(a.stats.today.runs)}</div>
            </div>
            <div>
              <div className="text-muted">llm</div>
              <div className="text-base font-bold">{fmtNumber(a.stats.today.llmCalls)}</div>
            </div>
            <div>
              <div className="text-muted">today</div>
              <div className="text-base font-bold">{fmtCurrency(a.stats.today.cost)}</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function tint(hex: string) {
  // 너무 어두우면 어두운 카드, 밝으면 페이퍼 위에 부드럽게
  if (!hex || hex.length < 4) return undefined;
  // 단순 alpha overlay 흉내
  return hex.startsWith('#') ? `${hex}10` : undefined;
}

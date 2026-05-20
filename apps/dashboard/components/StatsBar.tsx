'use client';
import { useEffect, useState } from 'react';
import { fmtCurrency, fmtNumber } from '@/lib/utils';

interface Stats {
  allTime: { costUsd: number; llmCalls: number; mentions: number; runs: number };
  today: { costUsd: number; llmCalls: number };
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/runtime/feed/stats')
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    load();
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, []);

  if (!stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="brut p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  const items = [
    { label: '오늘 비용', value: fmtCurrency(stats.today.costUsd), accent: 'bg-rust text-paper' },
    { label: '오늘 LLM 호출', value: fmtNumber(stats.today.llmCalls), accent: '' },
    { label: '총 멘션', value: fmtNumber(stats.allTime.mentions), accent: '' },
    { label: '총 실행', value: fmtNumber(stats.allTime.runs), accent: 'bg-moss text-paper' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      {items.map((it, i) => (
        <div
          key={i}
          className={`brut p-4 ${it.accent} fade-up`}
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <div className="font-mono text-[10px] uppercase tracking-wider opacity-70">
            {it.label}
          </div>
          <div className="font-display text-3xl font-extrabold mt-1">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

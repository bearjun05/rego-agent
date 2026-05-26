'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { weekLabel, weekLabelEn } from '@/lib/week';

export function Header() {
  // SSR ≠ client 시각 차이를 피하려고 클라이언트에서만 라벨 결정
  const [week, setWeek] = useState<{ ko: string; en: string }>({
    ko: '',
    en: '',
  });
  useEffect(() => {
    setWeek({ ko: weekLabel(), en: weekLabelEn() });
  }, []);

  return (
    <header className="border-b-2 border-line bg-paper sticky top-0 z-30">
      <div className="px-6 lg:px-10 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-baseline gap-3 group">
          <span className="font-display font-extrabold text-2xl tracking-tight">REGO</span>
          <span className="font-mono text-xs uppercase text-muted">/ AGENT.STUDY</span>
        </Link>

        <div className="font-mono text-xs uppercase tracking-widest text-muted hidden sm:block">
          {week.en || 'WEEK ?'}
        </div>
      </div>

      {/* 마키 — 동적 주차 라벨 */}
      <div className="marquee bg-ink text-paper py-1 font-mono text-xs uppercase border-t-2 border-b-2 border-line">
        <div className="marquee-inner">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="px-4">
              · WED 12:30 PM · {week.en || 'WEEK ?'} · SPARTA AGENT.STUDY · 16 LEARNERS · VIBE CODING ONLY ·
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ChatPanel } from './ChatPanel';

export function Header() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      <header className="border-b-2 border-ink bg-paper sticky top-0 z-30">
        <div className="px-6 lg:px-10 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-baseline gap-3 group">
            <span className="font-display font-extrabold text-2xl tracking-tight">REGO</span>
            <span className="font-mono text-xs uppercase text-muted">/ AGENT.STUDY</span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-3 font-mono text-xs uppercase tracking-wider">
            <Link href="/" className="px-3 py-1 hover:bg-ink hover:text-paper transition-colors">
              피드
            </Link>
            <Link
              href="/smoke"
              className="px-3 py-1 hover:bg-ink hover:text-paper transition-colors"
            >
              스모크
            </Link>
            <Link
              href="/admin"
              className="px-3 py-1 hover:bg-rust hover:text-paper transition-colors"
            >
              ADMIN
            </Link>
            <button onClick={() => setChatOpen((v) => !v)} className="btn btn-dark ml-2">
              💬 AI
            </button>
          </nav>
        </div>

        {/* 마키 */}
        <div className="marquee bg-ink text-paper py-1 font-mono text-xs uppercase border-t-2 border-b-2 border-ink">
          <div className="marquee-inner">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="px-4">
                · WED 12:30 PM · WEEK 1 · SLACK MENTION → TELEGRAM · 15 LEARNERS · VIBE CODING ONLY ·
              </span>
            ))}
          </div>
        </div>
      </header>

      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
    </>
  );
}

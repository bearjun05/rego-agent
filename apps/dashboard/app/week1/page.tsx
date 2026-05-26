import Link from 'next/link';
import { StatsBar } from '@/components/StatsBar';
import { ActivityFeed } from '@/components/ActivityFeed';
import { AgentGrid } from '@/components/AgentGrid';
import { MentionFlow } from '@/components/MentionFlow';
import { WeekLabel } from '@/components/WeekLabel';

export const dynamic = 'force-dynamic';

export default function Week1DashboardPage() {
  return (
    <div className="max-w-[1400px] mx-auto pt-8">
      {/* 헤더 */}
      <section className="mb-8">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-end justify-between">
          <div>
            <Link
              href="/"
              className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2 inline-block hover:text-ink"
            >
              ← 메인으로
            </Link>
            <div className="font-mono text-xs uppercase tracking-widest text-muted mb-1">
              SPARTA · AGENT STUDY
            </div>
            <h1 className="font-display font-extrabold text-4xl lg:text-6xl leading-none tracking-tight">
              <WeekLabel /> <span className="text-rust">대시보드</span>
            </h1>
            <p className="mt-3 text-sm text-muted max-w-xl">
              슬랙 멘션 → 텔레그램 알림(분류). 누가 무엇을 깎고 있는지, 멘션이 어떻게 흐르는지
              한눈에.
            </p>
          </div>
          <div className="font-mono text-[10px] uppercase text-muted leading-relaxed">
            <div className="border-l-2 border-ink pl-3">
              <div>매주 수요일 12:30 PM</div>
              <div>8주 / 15 참여자</div>
              <div>OpenRouter · Railway · Next.js</div>
            </div>
          </div>
        </div>
      </section>

      <StatsBar />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 mb-8">
        <ActivityFeed />

        <div>
          <h2 className="font-display font-bold text-2xl mb-3 flex items-baseline gap-2">
            <span>에이전트 갤러리</span>
            <span className="font-mono text-xs uppercase text-muted">{`{ live }`}</span>
          </h2>
          <AgentGrid />
        </div>
      </div>

      <MentionFlow />
    </div>
  );
}

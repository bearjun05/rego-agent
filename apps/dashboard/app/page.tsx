import { StatsBar } from '@/components/StatsBar';
import { ActivityFeed } from '@/components/ActivityFeed';
import { AgentGrid } from '@/components/AgentGrid';
import { MentionFlow } from '@/components/MentionFlow';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <div className="max-w-[1400px] mx-auto pt-8">
      {/* Hero */}
      <section className="mb-8 noise">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-end justify-between">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted mb-2">
              SPARTA · AGENT STUDY · WEEK 1
            </div>
            <h1 className="font-display font-extrabold text-5xl lg:text-7xl leading-none tracking-tight">
              깎아보자.<br />
              <span className="text-rust">너만의 비서를.</span>
            </h1>
            <p className="text-muted text-sm mt-4 max-w-md leading-relaxed">
              슬랙에서 본인 이름이 태그되면 무슨 일이 일어날지, 본인 코드로 결정한다.
              15명이 매주 같은 미션을 다르게 풀고, 서로 구경하며 배운다.
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

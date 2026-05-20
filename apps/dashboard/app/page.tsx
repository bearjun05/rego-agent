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
              깎아보자<br />
              <span className="text-rust">너만의 비서를.</span>
            </h1>
          </div>
          <div className="font-mono text-[10px] uppercase text-muted leading-relaxed">
            <div className="border-l-2 border-ink pl-3">
              <div>매주 수요일 12:30 PM</div>
              <div>8주 / 15 참여자</div>
              <div>OpenRouter · Railway · Next.js</div>
            </div>
          </div>
        </div>

        {/* 공식 */}
        <div className="mt-8 flex flex-wrap items-stretch gap-2 lg:gap-3">
          {[
            { ko: '모델', en: 'LLM' },
            { ko: '도구', en: 'Tools' },
            { ko: '규칙', en: 'Prompt' },
            { ko: '트리거', en: 'When?' },
          ].map((block, i) => (
            <div key={block.en} className="flex items-stretch gap-2 lg:gap-3">
              <div className="brut-tight px-3 py-2 min-w-[88px] lg:min-w-[112px]">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  {block.en}
                </div>
                <div className="font-display font-extrabold text-lg lg:text-xl leading-tight">
                  {block.ko}
                </div>
              </div>
              <div className="flex items-center font-display font-extrabold text-2xl lg:text-3xl text-muted">
                {i < 3 ? '+' : '='}
              </div>
            </div>
          ))}
          <div className="px-3 py-2 min-w-[88px] lg:min-w-[112px] border-2 border-ink bg-ink text-paper">
            <div className="font-mono text-[10px] uppercase tracking-wider opacity-70">
              Agent
            </div>
            <div className="font-display font-extrabold text-lg lg:text-xl leading-tight">
              에이전트
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

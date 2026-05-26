import Link from 'next/link';
import { MonitorCard } from '@/components/MonitorCard';
import { Leaderboard } from '@/components/week2/Leaderboard';
import { LiveActivityFeed } from '@/components/week2/LiveActivityFeed';
import { ToolUsageChart } from '@/components/week2/ToolUsageChart';
import { TelegramGallery } from '@/components/week2/TelegramGallery';
import { CellClearRates } from '@/components/week2/CellClearRates';
import { BlueprintGallery } from '@/components/week2/BlueprintGallery';
import { BrickWall } from '@/components/week2/BrickWall';

export const dynamic = 'force-dynamic';

export default function Week2Page() {
  return (
    <div className="max-w-[1280px] mx-auto pt-8 pb-16 px-4">
      <section className="mb-6">
        <div className="font-mono text-xs uppercase tracking-widest text-muted mb-2">
          WEEK 2 · 16명 실시간
        </div>
        <h1 className="font-display font-extrabold text-4xl lg:text-6xl leading-none tracking-tight">
          다같이, <span className="text-rust">조립중</span>.
        </h1>
        <p className="mt-4 text-base lg:text-lg text-muted max-w-2xl leading-relaxed">
          학습자 16명이 만들고 있는 에이전트들을 한눈에. 진행률·도구·텔레그램 메시지·청사진까지.
        </p>
      </section>

      {/* Row 0: 16명 Brick Wall (큰 시각화) */}
      <section className="mb-4">
        <BrickWall />
      </section>

      {/* Row 1: Leaderboard + Live Feed */}
      <section className="grid md:grid-cols-2 gap-4 mb-4">
        <Leaderboard />
        <LiveActivityFeed />
      </section>

      {/* Row 2: 전체 모니터링 (큰 영역) */}
      <section className="mb-4">
        <MonitorCard />
      </section>

      {/* Row 3: 도구 차트 + 셀별 클리어율 */}
      <section className="grid md:grid-cols-2 gap-4 mb-4">
        <ToolUsageChart />
        <CellClearRates />
      </section>

      {/* Row 4: 텔레그램 갤러리 */}
      <section className="mb-4">
        <TelegramGallery />
      </section>

      {/* Row 5: 청사진 갤러리 */}
      <section className="mb-8">
        <BlueprintGallery />
      </section>

      <section className="flex gap-3 flex-wrap">
        <Link
          href="/"
          className="brut px-4 py-2 font-mono text-xs hover:bg-sand transition-colors"
        >
          ← 인솔이 채팅
        </Link>
      </section>
    </div>
  );
}

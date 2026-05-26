import Link from 'next/link';
import { MonitorCard } from '@/components/MonitorCard';

export const dynamic = 'force-dynamic';

export default function Week2Page() {
  return (
    <div className="max-w-[1100px] mx-auto pt-8 pb-16">
      <section className="mb-6">
        <div className="font-mono text-xs uppercase tracking-widest text-muted mb-2">
          WEEK 2 · 실시간 모니터링
        </div>
        <h1 className="font-display font-extrabold text-4xl lg:text-6xl leading-none tracking-tight">
          16명, <span className="text-rust">실시간</span>.
        </h1>
        <p className="mt-4 text-base lg:text-lg text-muted max-w-2xl leading-relaxed">
          누가 어디까지 풀었나 · 누가 막혀있나 · 누가 활동중인가. 15초마다 자동 갱신.
        </p>
      </section>

      <section className="mb-8">
        <MonitorCard />
      </section>

      <section className="flex gap-3">
        <Link
          href="/"
          className="brut px-4 py-2 font-mono text-xs hover:bg-sand transition-colors"
        >
          ← 인솔이 채팅
        </Link>
        <Link
          href="/week1"
          className="brut px-4 py-2 font-mono text-xs hover:bg-sand transition-colors"
        >
          1주차 대시보드
        </Link>
        <Link
          href="/admin"
          className="brut px-4 py-2 font-mono text-xs hover:bg-sand transition-colors"
        >
          운영 관리 (admin)
        </Link>
      </section>
    </div>
  );
}

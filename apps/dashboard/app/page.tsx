import Link from 'next/link';
import { HomeChat } from '@/components/HomeChat';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <div className="max-w-[1100px] mx-auto pt-8">
      {/* Hero */}
      <section className="mb-8 noise">
        <div className="font-mono text-xs uppercase tracking-widest text-muted mb-2">
          SPARTA · AGENT STUDY · 8 WEEKS
        </div>
        <h1 className="font-display font-extrabold text-5xl lg:text-7xl leading-none tracking-tight relative">
          <span className="inline-flex items-center gap-3 flex-wrap">
            레고처럼
            <span className="brick-row" aria-hidden>
              <span className="brick-stud brick-stud-on" style={{width:12, height:12}} />
              <span className="brick-stud brick-stud-on" style={{width:12, height:12}} />
              <span className="brick-stud brick-stud-on" style={{width:12, height:12}} />
              <span className="brick-stud brick-stud-on" style={{width:12, height:12}} />
            </span>
          </span>
          <br />
          <span className="text-rust">조립하는 에이전트.</span>
        </h1>
        <p className="mt-5 text-base lg:text-lg text-muted max-w-2xl leading-relaxed">
          모델 + 도구 + 규칙 + 트리거를 블록처럼 끼워 맞춰, 나만의 비서를 만들어요.
        </p>

        {/* 공식 */}
        <div className="mt-6 flex flex-wrap items-stretch gap-2 lg:gap-3">
          {[
            { ko: '모델', en: 'LLM' },
            { ko: '도구', en: 'Tools' },
            { ko: '규칙', en: 'Prompt' },
            { ko: '트리거', en: 'When?' },
          ].map((block, i) => (
            <div key={block.en} className="flex items-stretch gap-2 lg:gap-3">
              <div className="brut-tight px-3 py-2 min-w-[80px] lg:min-w-[100px]">
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
          <div className="px-3 py-2 min-w-[80px] lg:min-w-[100px] border-2 border-ink bg-ink text-paper">
            <div className="font-mono text-[10px] uppercase tracking-wider opacity-70">Agent</div>
            <div className="font-display font-extrabold text-lg lg:text-xl leading-tight">
              에이전트
            </div>
          </div>
        </div>
      </section>

      {/* 큰 AI 코치 챗봇 — 입장 시 오늘 할 일 능동 안내 */}
      <section className="mb-12">
        <HomeChat />
      </section>

      {/* 주차별 대시보드 */}
      <section className="mb-16 grid md:grid-cols-2 gap-4">
        <Link
          href="/week1"
          className="brut p-6 flex flex-col gap-2 group hover:bg-sand transition-colors"
        >
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            WEEK 1 · ONBOARDING
          </div>
          <div className="font-display font-bold text-xl">1주차 대시보드</div>
          <div className="text-sm text-muted">
            참여자별 에이전트 카드, 멘션 흐름, 실시간 비용·활동.
          </div>
          <span className="font-display font-extrabold text-2xl text-rust mt-auto self-end group-hover:translate-x-1 transition-transform">
            →
          </span>
        </Link>
        <Link
          href="/week2"
          className="brut p-6 flex flex-col gap-2 group hover:bg-sand transition-colors"
        >
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            WEEK 2 · 실시간 모니터링
          </div>
          <div className="font-display font-bold text-xl">실시간 16명 진행률</div>
          <div className="text-sm text-muted">
            누가 어디까지 풀었나, 누가 막혀있나. 15초마다 갱신.
          </div>
          <span className="font-display font-extrabold text-2xl text-rust mt-auto self-end group-hover:translate-x-1 transition-transform">
            →
          </span>
        </Link>
      </section>
    </div>
  );
}

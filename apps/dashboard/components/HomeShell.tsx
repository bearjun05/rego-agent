'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HomeChat } from './HomeChat';

/**
 * 레이아웃별로 홈 화면 구조를 바꾸는 클라이언트 셸.
 * data-layout (html element) 을 읽어서 10개 archetype 중 하나로 분기.
 */
export function HomeShell() {
  const [layout, setLayout] = useState<string>('classic');

  useEffect(() => {
    const sync = () => {
      const v = document.documentElement.dataset.layout || 'classic';
      setLayout(v);
    };
    sync();
    // 레이아웃 스위처가 attribute 만 갱신해도 반영
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout'] });
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {layout === 'classic' && <ClassicLayout />}
      {layout === 'rail-right' && <RailRightLayout />}
      {layout === 'bento' && <BentoLayout />}
      {layout === 'three-pane' && <ThreePaneLayout />}
      {layout === 'floating' && <FloatingLayout />}
      {layout === 'command' && <CommandLayout />}
      {layout === 'kanban' && <KanbanLayout />}
      {layout === 'stacked-feed' && <FeedLayout />}
      {layout === 'magazine' && <MagazineLayout />}
      {layout === 'tabbed' && <TabbedLayout />}
    </>
  );
}

/* ───────────────────────── 1. CLASSIC (기본) ───────────────────────── */
function ClassicLayout() {
  return (
    <div className="max-w-[1100px] mx-auto pt-4">
      <Hero compact={false} />
      <section className="mb-6">
        <HomeChat />
      </section>
      <MonitorTile />
    </div>
  );
}

/* ───────────────────────── 2. RAIL RIGHT ───────────────────────── */
function RailRightLayout() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 max-w-[1400px] mx-auto pt-4">
      <div className="space-y-6 min-w-0">
        <Hero compact />
        <MonitorTile />
        <SecondaryFeed />
      </div>
      <aside className="lg:sticky lg:top-4 lg:self-start" style={{ height: 'calc(100vh - 32px)' }}>
        <div className="font-mono text-[10px] uppercase text-muted mb-2">▎ 인솔이 (rail)</div>
        <div className="h-[calc(100%-24px)]">
          <HomeChat />
        </div>
      </aside>
    </div>
  );
}

/* ───────────────────────── 3. BENTO GRID ───────────────────────── */
function BentoLayout() {
  return (
    <div className="max-w-[1300px] mx-auto pt-4 grid grid-cols-1 lg:grid-cols-4 gap-4 auto-rows-[min-content]">
      <div className="lg:col-span-3 lg:row-span-1">
        <Hero compact />
      </div>
      <BentoTile label="STREAK" value="12" sub="연속 출석일" tone="var(--th-primary-2)" />
      <BentoTile label="PIECES" value="6/9" sub="이번 주 빙고" tone="var(--th-primary-1)" />
      <BentoTile label="MENTIONS" value="143" sub="누적 처리" tone="var(--th-primary-3)" />
      <BentoTile label="UPTIME" value="99.2%" sub="에이전트 가용" tone="var(--th-primary-4)" />
      <div className="lg:col-span-2 lg:row-span-2">
        <HomeChat />
      </div>
      <div className="lg:col-span-2">
        <MonitorTile />
      </div>
      <div className="lg:col-span-2">
        <SecondaryFeed compact />
      </div>
    </div>
  );
}

/* ───────────────────────── 4. THREE PANE ───────────────────────── */
function ThreePaneLayout() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_280px] gap-4 max-w-[1500px] mx-auto pt-2">
      <nav className="space-y-2 lg:sticky lg:top-4 lg:self-start">
        <div className="font-mono text-[10px] uppercase text-muted mb-2">NAV</div>
        {['홈', '빙고판', '에이전트', '실행 로그', '도구함', '관리자'].map((label, i) => (
          <Link
            href="#"
            key={label}
            className="block px-3 py-2 border-2 border-ink hover:bg-sand text-sm font-display"
            style={{ background: i === 0 ? 'var(--th-bg-alt)' : 'transparent' }}
          >
            {label}
          </Link>
        ))}
        <div className="mt-4 font-mono text-[9px] uppercase text-muted">4축</div>
        {['모델', '도구', '규칙', '트리거'].map((l, i) => (
          <div key={l} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block w-2.5 h-2.5"
              style={{ background: `var(--th-primary-${i + 1})` }}
            />
            <span>{l}</span>
          </div>
        ))}
      </nav>
      <div className="min-w-0 space-y-4">
        <Hero compact />
        <HomeChat />
      </div>
      <aside className="lg:sticky lg:top-4 lg:self-start space-y-3">
        <div className="font-mono text-[10px] uppercase text-muted">INSPECTOR</div>
        <InspectorBlock title="오늘의 미션" body="3번 빙고 — 이모지 자동 반응" tone="rust" />
        <InspectorBlock title="진행률" body="6/9 — 한 발 남았어요" tone="green" />
        <InspectorBlock title="다음 깨알" body="텔레그램 버튼 콜백 만들어봐" tone="blue" />
        <div className="brut p-3 bg-paper">
          <div className="font-mono text-[10px] text-muted mb-1">최근 활동</div>
          <ul className="text-xs space-y-1">
            <li>· 슬랙 멘션 +3</li>
            <li>· 코드 리로드 14:22</li>
            <li>· 텔레그램 콜백 ok</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

/* ───────────────────────── 5. FLOATING CANVAS ───────────────────────── */
function FloatingLayout() {
  return (
    <div className="relative max-w-none -mx-6 lg:-mx-10 min-h-[calc(100vh-180px)]">
      <CanvasBackdrop />
      <div className="relative z-10 max-w-[800px] mx-auto pt-8 px-6">
        <Hero compact />
      </div>
      {/* 우측 하단 floating chat — drag 가능한 느낌만 */}
      <div
        className="fixed bottom-4 right-4 z-30 brut bg-paper shadow-2xl"
        style={{ width: 'min(420px, calc(100vw - 32px))', height: 'min(560px, calc(100vh - 80px))' }}
      >
        <div className="h-full overflow-hidden">
          <HomeChat />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 6. COMMAND PALETTE ───────────────────────── */
function CommandLayout() {
  return (
    <div className="max-w-[900px] mx-auto pt-12 px-4">
      <div className="text-center mb-8">
        <div className="font-mono text-[10px] uppercase text-muted tracking-widest mb-2">
          REGO · command-first
        </div>
        <h1 className="font-display font-extrabold text-4xl lg:text-6xl leading-none">
          뭐 도와줄까요?
        </h1>
        <p className="mt-3 text-sm text-muted">⌘K · 또는 그냥 적어요</p>
      </div>
      <div className="brut bg-paper p-2 mb-6">
        <HomeChat />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { k: '/run', d: '내 에이전트 한 번 돌리기' },
          { k: '/who', d: '누가 잘 하고 있어?' },
          { k: '/help', d: '셀 안내 다시 보기' },
          { k: '/theme', d: '테마 바꾸기' },
        ].map((c) => (
          <div key={c.k} className="brut-tight px-3 py-2 bg-paper">
            <div className="font-mono text-xs">{c.k}</div>
            <div className="text-[11px] text-muted">{c.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── 7. KANBAN ───────────────────────── */
function KanbanLayout() {
  const cols = [
    {
      title: '이번 주 (TODO)',
      tone: 'var(--th-primary-1)',
      cards: ['3번 빙고 — 이모지 자동 반응', '5번 빙고 — 텔레그램 버튼', '7번 빙고 — 자동 답장'],
    },
    {
      title: '진행 중 (DOING)',
      tone: 'var(--th-primary-2)',
      cards: ['6번 빙고 — 시도 중 분류 시도 중', 'OAuth 토큰 갱신 (실패 1회)'],
    },
    {
      title: '완료 (DONE)',
      tone: 'var(--th-primary-4)',
      cards: ['1번 빙고 — 슬랙 멘션 받기', '2번 빙고 — 텔레그램 알림', '4번 빙고 — 봇 토큰 등록'],
    },
  ];
  return (
    <div className="max-w-[1400px] mx-auto pt-2">
      <Hero compact mini />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {cols.map((c) => (
          <div key={c.title} className="brut bg-paper p-3 min-h-[260px]">
            <div
              className="font-display font-bold text-sm mb-3 pb-2 border-b-2"
              style={{ borderColor: c.tone }}
            >
              {c.title}
            </div>
            <div className="space-y-2">
              {c.cards.map((t) => (
                <div
                  key={t}
                  className="brut-tight p-2 text-xs bg-paper hover:bg-sand cursor-grab"
                  style={{ borderLeftWidth: 4, borderLeftColor: c.tone as string }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="brut bg-paper" style={{ height: 460 }}>
        <div className="font-mono text-[10px] uppercase text-muted p-2 border-b-2 border-ink">
          🐾 인솔이 (도킹)
        </div>
        <div className="h-[calc(100%-32px)]">
          <HomeChat />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 8. STACKED FEED ───────────────────────── */
function FeedLayout() {
  return (
    <div className="max-w-[640px] mx-auto pt-4 space-y-4">
      <Hero compact mini />
      <HomeChat />
      <FeedCard tone="var(--th-primary-1)" kind="MENTION" title="@수미 슬랙 멘션 도착" body="“이번 주차 자료 부탁드려요” — 분류: request" />
      <FeedCard tone="var(--th-primary-2)" kind="RUN" title="에이전트 실행 #42" body="cron 09:00 — 0.8s — ok" />
      <FeedCard tone="var(--th-primary-3)" kind="LESSON" title="4번 빙고 — 텔레그램 버튼" body="callback_query 한 줄로 처리하는 법" />
      <FeedCard tone="var(--th-primary-4)" kind="TODO" title="OAuth 재인증 필요" body="Slack 토큰 만료 D-2" />
    </div>
  );
}

/* ───────────────────────── 9. MAGAZINE ───────────────────────── */
function MagazineLayout() {
  return (
    <div className="max-w-[1300px] mx-auto pt-2">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <article className="lg:col-span-2 brut bg-paper p-6 lg:p-8 noise hero-clean">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">
            ISSUE 2026·05 · COVER STORY
          </div>
          <h1 className="font-display font-extrabold text-4xl lg:text-6xl leading-[0.95] mb-4">
            레고처럼<br />조립하는 에이전트.
          </h1>
          <p className="text-base text-muted leading-relaxed max-w-xl">
            모델 + 도구 + 규칙 + 트리거를 블록처럼. 한 사람씩 자기 비서를 깎는다.
          </p>
        </article>
        <div className="space-y-4">
          <article className="brut bg-paper p-4">
            <div className="font-mono text-[10px] uppercase text-muted">KICKER</div>
            <div className="font-display font-extrabold text-2xl leading-tight">
              16명 · 8주 · 1만 줄
            </div>
            <div className="text-xs text-muted mt-1">사내 비밀스러운 컬트(?)</div>
          </article>
          <article className="brut bg-paper p-4">
            <div className="font-mono text-[10px] uppercase text-muted">SIDE</div>
            <div className="font-display font-bold text-lg leading-tight">이번 주차</div>
            <p className="text-xs mt-1">슬랙 멘션 → 분류 → 텔레그램. 본인이 만든다.</p>
          </article>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase text-muted mb-2">FEATURE — 인솔이</div>
          <HomeChat />
        </div>
        <div className="space-y-4">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted mb-2">REPORT — 모니터</div>
            <MonitorTile />
          </div>
          <SecondaryFeed compact />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 10. TABBED ───────────────────────── */
function TabbedLayout() {
  const [tab, setTab] = useState<'chat' | 'bingo' | 'monitor' | 'axes'>('chat');
  const tabs = [
    { id: 'chat' as const, label: '챗 / 인솔이' },
    { id: 'bingo' as const, label: '빙고판' },
    { id: 'monitor' as const, label: '모니터' },
    { id: 'axes' as const, label: '4축' },
  ];
  return (
    <div className="max-w-[1200px] mx-auto pt-2">
      <div className="flex gap-0 mb-4 border-b-2 border-ink overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 font-mono text-xs uppercase border-2 border-b-0 -mb-[2px] whitespace-nowrap ${
              tab === t.id ? 'bg-paper border-ink' : 'bg-transparent border-transparent text-muted hover:bg-sand'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1 border-b-2 border-ink" />
      </div>
      {tab === 'chat' && <HomeChat />}
      {tab === 'bingo' && (
        <div className="brut bg-paper p-6 text-center text-muted">
          <div className="font-display text-2xl mb-2">빙고판은 챗 안에서 자동 표시됩니다.</div>
          <div className="text-xs">챗 탭으로 가서 이름 입력하면 빙고판 카드가 떠요.</div>
        </div>
      )}
      {tab === 'monitor' && <MonitorTile big />}
      {tab === 'axes' && <AxesPanel />}
    </div>
  );
}

/* ─────────────────── 공용 sub-컴포넌트 ─────────────────── */

function Hero({ compact, mini }: { compact?: boolean; mini?: boolean }) {
  if (mini) {
    return (
      <section className="mb-3 px-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
          SPARTA · AGENT STUDY · 8 WEEKS
        </div>
        <h1 className="font-display font-extrabold text-2xl leading-tight">
          레고처럼 조립하는 에이전트.
        </h1>
      </section>
    );
  }
  return (
    <section className={`${compact ? 'mb-4 p-4 lg:p-5' : 'mb-8 p-6 lg:p-8 -mx-6 lg:-mx-8'} noise hero-clean`}>
      <div className="font-mono text-xs uppercase tracking-widest text-muted mb-2">
        SPARTA · AGENT STUDY · 8 WEEKS
      </div>
      <h1
        className={`font-display font-extrabold ${
          compact ? 'text-3xl lg:text-4xl' : 'text-5xl lg:text-7xl'
        } leading-none tracking-tight`}
      >
        <span className="inline-flex items-center gap-3 flex-wrap">
          레고처럼
          <span className="brick-row" aria-hidden>
            <span className="brick-stud brick-stud-on" style={{ width: 12, height: 12 }} />
            <span className="brick-stud brick-stud-on" style={{ width: 12, height: 12 }} />
            <span className="brick-stud brick-stud-on" style={{ width: 12, height: 12 }} />
            <span className="brick-stud brick-stud-on" style={{ width: 12, height: 12 }} />
          </span>
        </span>
        <br />
        <span className="text-rust">조립하는 에이전트.</span>
      </h1>
      {!compact && (
        <p className="mt-5 text-base lg:text-lg text-muted max-w-2xl leading-relaxed">
          모델 + 도구 + 규칙 + 트리거를 블록처럼 끼워 맞춰, 나만의 비서를 만들어요.
        </p>
      )}
      <AxesRow compact={compact} />
    </section>
  );
}

function AxesRow({ compact }: { compact?: boolean }) {
  const blocks = [
    { ko: '모델', en: 'LLM', tone: 'var(--th-primary-3)' },
    { ko: '도구', en: 'Tools', tone: 'var(--th-primary-2)' },
    { ko: '규칙', en: 'Prompt', tone: 'var(--th-primary-3)' },
    { ko: '트리거', en: 'When?', tone: 'var(--th-primary-1)' },
  ];
  return (
    <div className={`${compact ? 'mt-3' : 'mt-6'} flex flex-wrap items-stretch gap-1.5 lg:gap-3 stagger`}>
      {blocks.map((block, i) => (
        <div key={block.en} className="flex items-stretch gap-1.5 lg:gap-3">
          <div
            className={`brut-tight ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} relative`}
            style={{ backgroundColor: `color-mix(in srgb, ${block.tone} 18%, var(--th-bg))` }}
          >
            <span
              aria-hidden
              className="absolute top-1 right-1 w-2 h-2 rounded-full"
              style={{ background: block.tone }}
            />
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted">{block.en}</div>
            <div className={`font-display font-extrabold ${compact ? 'text-sm' : 'text-lg lg:text-xl'} leading-tight`}>
              {block.ko}
            </div>
          </div>
          <div className={`flex items-center font-display font-extrabold ${compact ? 'text-lg' : 'text-2xl lg:text-3xl'} text-muted`}>
            {i < 3 ? '+' : '='}
          </div>
        </div>
      ))}
      <div className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} border-2 border-ink bg-ink text-paper`}>
        <div className="font-mono text-[9px] uppercase tracking-wider opacity-70">Agent</div>
        <div className={`font-display font-extrabold ${compact ? 'text-sm' : 'text-lg lg:text-xl'} leading-tight`}>
          에이전트
        </div>
      </div>
    </div>
  );
}

function MonitorTile({ big }: { big?: boolean } = {}) {
  return (
    <Link
      href="/week2"
      className={`brut p-6 flex flex-col gap-2 group hover:bg-sand transition-colors ${big ? 'min-h-[280px]' : ''}`}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">실시간 모니터링</div>
      <div className="font-display font-bold text-xl">16명 진행률 한눈에</div>
      <div className="text-sm text-muted">누가 어디까지 풀었나, 누가 막혀있나. 15초마다 갱신.</div>
      <span className="font-display font-extrabold text-2xl text-rust mt-auto self-end group-hover:translate-x-1 transition-transform">
        →
      </span>
    </Link>
  );
}

function BentoTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div
      className="brut p-4 flex flex-col justify-between min-h-[120px]"
      style={{ background: `color-mix(in srgb, ${tone} 12%, var(--th-card-bg))` }}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div>
        <div className="font-display font-extrabold text-3xl leading-none">{value}</div>
        <div className="text-xs text-muted mt-1">{sub}</div>
      </div>
    </div>
  );
}

function InspectorBlock({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: 'rust' | 'green' | 'blue';
}) {
  const color =
    tone === 'rust' ? 'var(--th-accent)' : tone === 'green' ? 'var(--th-primary-4)' : 'var(--th-primary-1)';
  return (
    <div className="brut p-3 bg-paper" style={{ borderLeftWidth: 4, borderLeftColor: color }}>
      <div className="font-mono text-[9px] uppercase text-muted">{title}</div>
      <div className="text-sm font-display font-bold leading-tight">{body}</div>
    </div>
  );
}

function SecondaryFeed({ compact }: { compact?: boolean } = {}) {
  return (
    <div className="brut bg-paper p-4">
      <div className="font-mono text-[10px] uppercase text-muted mb-2">최근 활동</div>
      <ul className={`${compact ? 'space-y-1 text-xs' : 'space-y-2 text-sm'}`}>
        <li>· @수미 슬랙 멘션 처리 — 2분 전</li>
        <li>· @기철 cron 발화 — 5분 전</li>
        <li>· @웅준 코드 리로드 — 11분 전</li>
        <li>· @지선 5번 빙고 클리어 — 18분 전</li>
      </ul>
    </div>
  );
}

function FeedCard({
  tone,
  kind,
  title,
  body,
}: {
  tone: string;
  kind: string;
  title: string;
  body: string;
}) {
  return (
    <div className="brut bg-paper p-4" style={{ borderLeftWidth: 6, borderLeftColor: tone }}>
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted mb-1">{kind}</div>
      <div className="font-display font-bold text-base leading-tight">{title}</div>
      <div className="text-xs text-muted mt-1">{body}</div>
    </div>
  );
}

function AxesPanel() {
  const axes = [
    { ko: '모델', en: 'LLM', tone: 'var(--th-primary-3)', desc: '뇌. OpenRouter deepseek/claude/openai 등 골라 끼움.' },
    { ko: '도구', en: 'Tools', tone: 'var(--th-primary-2)', desc: '손. Slack reply, Telegram send, Calendar list 같은 동사.' },
    { ko: '규칙', en: 'Prompt', tone: 'var(--th-primary-3)', desc: '성격·말투. 시스템 프롬프트로 행동을 결정.' },
    { ko: '트리거', en: 'When?', tone: 'var(--th-primary-1)', desc: '언제 깨우나. 멘션·cron·웹훅·콜백.' },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {axes.map((a) => (
        <div
          key={a.en}
          className="brut p-5"
          style={{ background: `color-mix(in srgb, ${a.tone} 14%, var(--th-card-bg))` }}
        >
          <div className="font-mono text-[10px] uppercase text-muted">{a.en}</div>
          <div className="font-display font-extrabold text-3xl">{a.ko}</div>
          <p className="text-sm text-muted mt-2 leading-relaxed">{a.desc}</p>
        </div>
      ))}
    </div>
  );
}

function CanvasBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg className="w-full h-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 600">
        <defs>
          <pattern id="grid-dots" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.4" fill="var(--th-fg)" opacity="0.18" />
          </pattern>
        </defs>
        <rect width="800" height="600" fill="url(#grid-dots)" />
        <circle cx="240" cy="180" r="80" fill="var(--th-primary-1)" opacity="0.18" />
        <circle cx="600" cy="320" r="110" fill="var(--th-primary-3)" opacity="0.16" />
        <circle cx="420" cy="500" r="60" fill="var(--th-primary-2)" opacity="0.22" />
        <line x1="240" y1="180" x2="600" y2="320" stroke="var(--th-fg)" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.4" />
        <line x1="600" y1="320" x2="420" y2="500" stroke="var(--th-fg)" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.4" />
      </svg>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { AgentBlueprint } from './AgentBlueprint';

interface Stats {
  runs: { total: number; success: number; failed: number };
  toolCalls: { total: number; topTools: Array<{ id: string; count: number }> };
  llmCalls: { total: number; totalCostUsd: number };
  telegramSent: number;
  mentionsReceived: number;
  bingoDone: number;
}

interface Blueprint {
  agent: string;
  displayName: string | null;
  triggers: string[];
  tools: string[];
  hasOnCron: boolean;
  hasOnTelegramCallback: boolean;
  handlerLines: number;
  stats: { runs: number; toolCalls: number; telegramSent: number; llmCost: number };
}

interface LearnerData {
  stats: Stats;
  blueprint: Blueprint;
  code: { handlerExists: boolean; lines: number };
}

const STEPS = [
  { id: 'intro', title: '🎉 6칸 돌파!' },
  { id: 'blueprint', title: '📐 당신이 만든 청사진' },
  { id: 'stats', title: '🧱 조립한 블록들' },
  { id: 'metaphor', title: '🤖 에이전트는 레고다' },
  { id: 'next', title: '🚀 다음 단계' },
];

export function RevealModal({
  agentSlug,
  onClose,
}: {
  agentSlug: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<LearnerData | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    fetch(`/api/runtime/insol/learner-stats?agent=${encodeURIComponent(agentSlug)}`)
      .then((r) => r.json())
      .then((d: LearnerData) => setData(d))
      .catch(() => {});
  }, [agentSlug]);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  const current = STEPS[step]!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-fade" style={{ background: 'color-mix(in srgb, var(--th-fg) 70%, transparent)' }}>
      {/* Confetti rain — 1단계에서만 */}
      {step === 0 && <ConfettiRain />}
      <div className="brut max-w-[820px] w-full max-h-[90vh] overflow-y-auto relative">
        {/* 헤더 */}
        <div className="border-b-brick border-line p-4 flex items-center justify-between sticky top-0 bg-paper z-10">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted">
              빙고 리빌 · {step + 1}/{STEPS.length}
            </div>
            <div className="font-display font-extrabold text-2xl">{current.title}</div>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-xs px-3 py-1 border-2 border-ink hover:bg-sand"
          >
            닫기
          </button>
        </div>

        {/* 본문 */}
        <div key={current.id} className="p-6 step-in">
          {!data && (
            <div className="font-mono text-sm text-muted text-center py-12">불러오는 중...</div>
          )}
          {data && current.id === 'intro' && <Intro stats={data.stats} blueprint={data.blueprint} />}
          {data && current.id === 'blueprint' && <BlueprintStep blueprint={data.blueprint} />}
          {data && current.id === 'stats' && <StatsStep stats={data.stats} blueprint={data.blueprint} />}
          {data && current.id === 'metaphor' && <MetaphorStep />}
          {data && current.id === 'next' && <NextStep />}
        </div>

        {/* 푸터 */}
        <div className="border-t-2 border-ink p-4 flex items-center justify-between sticky bottom-0 bg-paper">
          <button
            onClick={prev}
            disabled={step === 0}
            className="font-mono text-xs px-4 py-2 border-2 border-ink hover:bg-sand disabled:opacity-30"
          >
            ← 이전
          </button>
          <div className="flex gap-1">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`w-2 h-2 rounded-full ${i === step ? 'bg-ink' : 'bg-muted/30'}`}
              />
            ))}
          </div>
          {step < STEPS.length - 1 ? (
            <button onClick={next} className="btn btn-dark text-xs">
              다음 →
            </button>
          ) : (
            <button onClick={onClose} className="btn btn-dark text-xs">
              계속 작업하기 ✨
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Intro({ stats, blueprint }: { stats: Stats; blueprint: Blueprint }) {
  return (
    <div className="space-y-4">
      <p className="text-lg leading-relaxed">
        <strong>{blueprint.displayName ?? blueprint.agent}</strong>님,{' '}
        <span className="text-rust font-bold">빙고 {stats.bingoDone}칸 클리어!</span>
      </p>
      <p className="text-base leading-relaxed">
        지금까지 만든 걸 잠깐 같이 봐요. 코드 한 줄씩 짜셨는데, 그게 합쳐져서{' '}
        <strong>진짜 AI 에이전트 하나가 돌아가는 중</strong>이에요.
      </p>
      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat label="처리한 멘션" value={stats.runs.success} />
        <Stat label="도구 호출" value={stats.toolCalls.total} />
        <Stat label="LLM 호출" value={stats.llmCalls.total} />
      </div>
    </div>
  );
}

function BlueprintStep({ blueprint }: { blueprint: Blueprint }) {
  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed">
        이게 당신의 에이전트 청사진이에요. <strong>왼쪽 트리거</strong>가 일어나면{' '}
        <strong>가운데 핸들러</strong>가 깨어나서 <strong>오른쪽 도구</strong>들을 부르죠.
      </p>
      <div className="brut bg-paper p-4">
        <AgentBlueprint blueprint={blueprint} />
      </div>
      <p className="text-sm text-muted">
        각 도구는 슬랙·텔레그램·LLM 같은 외부 API를 호출하는 작은 함수예요.
      </p>
    </div>
  );
}

function StatsStep({ stats, blueprint }: { stats: Stats; blueprint: Blueprint }) {
  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed">조립한 블록을 정리하면:</p>
      <ul className="space-y-2 font-mono text-sm">
        <li>
          🧱 <strong>TypeScript 핸들러</strong> 1개 ({blueprint.handlerLines}줄)
        </li>
        <li>
          ⚡ <strong>트리거</strong> {blueprint.triggers.length}개:{' '}
          {blueprint.triggers.join(', ') || '없음'}
        </li>
        <li>
          🔧 <strong>도구 호출</strong> {blueprint.tools.length}종 사용 (총{' '}
          {stats.toolCalls.total}번 호출):
          <ul className="ml-6 mt-1 space-y-1 text-xs">
            {blueprint.tools.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </li>
        <li>
          🧠 <strong>LLM</strong> {stats.llmCalls.total}번 호출 (총 비용 $
          {stats.llmCalls.totalCostUsd.toFixed(4)})
        </li>
        <li>
          📱 <strong>텔레그램 알림</strong> {stats.telegramSent}번 발송
        </li>
      </ul>
      <p className="text-base leading-relaxed mt-4">
        이게 다 합쳐져서 <strong>한 에이전트</strong>가 된 거예요. 코드 한 줄씩 바꿀 때마다 이
        구조가 진화한 거고요.
      </p>
    </div>
  );
}

function MetaphorStep() {
  // 4축 = primary 컬러 토큰을 사용해 테마에 자동 반응
  const blocks = [
    { tone: 'var(--th-primary-1)', label: '🟦 트리거', desc: '"언제 깨어날까?"', ex: 'slack.mention / cron / button' },
    { tone: 'var(--th-primary-2)', label: '🟨 도구', desc: '"뭘 할 수 있을까?"', ex: 'slack.* / telegram.* / llm.*' },
    { tone: 'var(--th-primary-3)', label: '🟪 규칙', desc: '"어떻게 판단할까?"', ex: 'prompts/classify.md' },
    { tone: 'var(--th-primary-4)', label: '🟩 상태', desc: '"뭘 기억할까?"', ex: 'ctx.state.set / get' },
  ];
  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed">
        모든 에이전트는 결국 4가지 블록의 조합이에요:
      </p>
      <div className="grid grid-cols-2 gap-3">
        {blocks.map((b) => (
          <div
            key={b.label}
            className="brick-drop brut p-3 relative"
            style={{
              backgroundColor: `color-mix(in srgb, ${b.tone} 20%, var(--th-bg))`,
              borderColor: b.tone,
            }}
          >
            <div
              className="absolute top-2 right-2 w-3 h-3 rounded-full"
              style={{ backgroundColor: b.tone }}
            />
            <div className="font-display font-bold text-sm">{b.label}</div>
            <div className="font-mono text-[11px] mt-1">{b.desc}</div>
            <div className="font-mono text-[10px] text-muted mt-2">{b.ex}</div>
          </div>
        ))}
      </div>
      <p className="text-base leading-relaxed mt-4">
        4축을 <strong>다른 모양으로 끼우면</strong> 완전히 다른 에이전트가 돼요. 회의 알리미·뉴스
        요약기·내 스케줄 알림이 — 다 같은 4축 다른 조합.
      </p>
    </div>
  );
}

function ConfettiRain() {
  // 30개의 confetti가 위에서 떨어짐 (4가지 색)
  const colors = ['var(--th-accent)', 'var(--th-primary-1)', 'var(--th-primary-2)', 'var(--th-primary-4)'];
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 30 }).map((_, i) => {
        const left = (i / 30) * 100 + Math.random() * 5;
        const delay = Math.random() * 1500;
        const dur = 2200 + Math.random() * 1400;
        return (
          <span
            key={i}
            className="confetti-rain"
            style={{
              left: `${left}%`,
              top: -20,
              background: colors[i % colors.length],
              animationDelay: `${delay}ms`,
              animationDuration: `${dur}ms`,
              borderRadius: i % 2 === 0 ? '2px' : '50%',
            }}
          />
        );
      })}
    </div>
  );
}

function NextStep() {
  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed">
        이제 본격적으로 본인 에이전트를 키워볼 시간이에요:
      </p>
      <ul className="space-y-3">
        <li className="brut p-3 bg-paper">
          <div className="font-display font-bold text-sm mb-1">🎯 2주차 — 다른 사람 작품 보기</div>
          <div className="text-sm text-muted">
            <code>/week2</code> 페이지에서 다른 학습자의 청사진·텔레그램 메시지를 구경하고 영감
            받으세요.
          </div>
        </li>
        <li className="brut p-3 bg-paper">
          <div className="font-display font-bold text-sm mb-1">🛠 3주차+ — 본인만의 사용 사례</div>
          <div className="text-sm text-muted">
            본인이 평소 슬랙에서 답답했던 것 / 자동화하고 싶었던 것 — 9번 빙고에 적은 와우
            아이디어부터 시작.
          </div>
        </li>
      </ul>
      <p className="text-base leading-relaxed mt-4 text-center font-display font-bold">
        🧱 한 번 만든 블록은 영구 보존. 다음 주차에 그 위에 새 블록을 올리는 거예요.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="brut p-3 bg-sand text-center">
      <div className="font-display font-extrabold text-3xl">{value}</div>
      <div className="font-mono text-[10px] uppercase text-muted">{label}</div>
    </div>
  );
}

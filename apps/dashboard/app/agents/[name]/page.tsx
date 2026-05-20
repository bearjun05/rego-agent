'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { fmtRelativeTime, fmtCurrency, fmtDuration } from '@/lib/utils';

interface AgentDetail {
  agent: {
    name: string;
    displayName: string | null;
    icon: string;
    color: string;
    description: string | null;
    isPaused: boolean;
    pausedReason: string | null;
    githubHandle: string | null;
    loaded: boolean;
    analysisSummary: string | null;
    capabilities: string[] | null;
    techniques: string[] | null;
    analyzedAt: string | null;
    telegramChatId: string | null;
    manifest: {
      tools?: string[];
      triggers?: Array<{ type: string; channel?: string; emoji?: string; schedule?: string }>;
    } | null;
    updatedAt: string;
  };
  totalCostUsd: number;
}

interface Fixture {
  id: string;
  title: string;
  text: string;
  channelName?: string;
  userName?: string;
  expectedCategory?: string;
}

interface AgentBrief {
  name: string;
  displayName: string | null;
  icon: string;
}

interface FlowItem {
  telegram: { id: number; text: string; sentAt: string };
  slack: {
    text: string;
    userName: string | null;
    channelName: string | null;
    permalink: string | null;
  } | null;
}

export default function AgentDetailPage() {
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);
  const [data, setData] = useState<AgentDetail | null>(null);

  const load = useCallback(() => {
    fetch(`/api/runtime/agents/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    load();
    const i = setInterval(load, 12_000);
    return () => clearInterval(i);
  }, [load]);

  if (!data?.agent) {
    return (
      <div className="max-w-[1100px] mx-auto pt-12 text-muted">
        <Link href="/week1" className="font-mono text-xs uppercase hover:underline">
          ← 돌아가기
        </Link>
        <div className="mt-8">로딩 중...</div>
      </div>
    );
  }

  const a = data.agent;

  return (
    <div className="max-w-[1100px] mx-auto pt-8">
      <Link href="/week1" className="font-mono text-xs uppercase hover:underline">
        ← 모든 에이전트
      </Link>

      {/* 헤더 */}
      <div className="brut p-6 mt-4 mb-8" style={{ background: `${a.color}10` }}>
        <div className="flex flex-col sm:flex-row gap-5 sm:items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-6xl">{a.icon}</div>
            <div>
              <h1 className="font-display font-extrabold text-4xl leading-none">
                {a.displayName ?? a.name}
              </h1>
              <div className="font-mono text-xs uppercase text-muted mt-1">@{a.name}</div>
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1 font-mono text-xs">
            {a.telegramChatId ? (
              <span className="text-moss">📱 텔레그램 연결됨</span>
            ) : (
              <span className="text-muted">📱 텔레그램 미연결 (/start 필요)</span>
            )}
            {a.isPaused && (
              <span className="bg-rust text-paper px-2 py-0.5 uppercase">⏸ 일시정지</span>
            )}
            <span className="text-muted">총 비용 {fmtCurrency(data.totalCostUsd)}</span>
          </div>
        </div>
      </div>

      {/* ───── 섹션 1: 어디까지 만들었어요? ───── */}
      <SectionWhatBuilt agent={a} />

      {/* ───── 섹션 2: 동작 테스트 해보기! ───── */}
      <SectionSmokeTest agentName={a.name} />

      {/* ───── 섹션 3: 실제로 동작하고 있어요! ───── */}
      <SectionLiveActivity agentName={a.name} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// 섹션 1: 어디까지 만들었어요? (AI 코드 분석)
// ═════════════════════════════════════════════════════════
function SectionWhatBuilt({ agent }: { agent: AgentDetail['agent'] }) {
  const hasAnalysis = !!agent.analysisSummary;

  return (
    <section className="mb-10">
      <SectionHeader emoji="🔍" title="어디까지 만들었어요?" sub="AI가 코드를 읽고 자동으로 분석했어요" />

      {!hasAnalysis ? (
        <div className="brut p-6 text-center text-muted">
          <div className="text-3xl mb-2">📝</div>
          아직 분석된 내용이 없어요.
          <div className="text-xs mt-1">코드를 push하면 AI가 자동으로 읽고 정리해줘요.</div>
        </div>
      ) : (
        <div className="brut p-6" style={{ background: `${agent.color}08` }}>
          <p className="text-lg leading-relaxed font-medium mb-5">{agent.analysisSummary}</p>

          {agent.capabilities && agent.capabilities.length > 0 && (
            <div className="mb-5">
              <div className="font-mono text-[10px] uppercase text-muted mb-2">할 수 있는 일</div>
              <ul className="space-y-1.5">
                {agent.capabilities.map((cap, i) => (
                  <li key={i} className="flex gap-2 text-sm fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                    <span className="text-moss">✓</span>
                    <span>{cap}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center border-t-2 border-ink pt-4">
            {agent.techniques?.map((t, i) => (
              <span key={i} className="font-mono text-[10px] uppercase bg-ink text-paper px-2 py-1">
                {t}
              </span>
            ))}
            {agent.manifest?.tools?.map((t, i) => (
              <span key={`tool-${i}`} className="font-mono text-[10px] uppercase border-2 border-ink px-2 py-1">
                {toolEmoji(t)} {t}
              </span>
            ))}
          </div>
          {agent.analyzedAt && (
            <div className="font-mono text-[10px] text-muted mt-3">
              분석 시각: {fmtRelativeTime(agent.analyzedAt)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════
// 섹션 2: 동작 테스트 해보기!
// ═════════════════════════════════════════════════════════
function SectionSmokeTest({ agentName }: { agentName: string }) {
  const [shared, setShared] = useState<Fixture[]>([]);
  const [instant, setInstant] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ status: string; result?: unknown; error?: string; durationMs: number; costUsd: number } | null>(null);

  useEffect(() => {
    fetch('/api/runtime/smoke/fixtures')
      .then((r) => r.json())
      .then((d: { shared?: Fixture[] }) => setShared((d.shared ?? []).slice(0, 5)))
      .catch(() => {});
  }, []);

  const run = async (body: Record<string, unknown>, key: string) => {
    setRunning(key);
    setLastResult(null);
    try {
      const res = await fetch('/api/runtime/smoke/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName, ...body }),
      });
      const data = (await res.json()) as { result?: typeof lastResult };
      setLastResult(data.result ?? null);
    } finally {
      setRunning(null);
    }
  };

  return (
    <section className="mb-10">
      <SectionHeader
        emoji="🧪"
        title="동작 테스트 해보기!"
        sub="가상 슬랙 멘션을 던져보고 어떻게 반응하는지 확인 (누구나 테스트 가능)"
      />

      {/* 즉시 입력 */}
      <div className="brut p-4 mb-4">
        <div className="font-mono text-[10px] uppercase text-muted mb-2">직접 메시지 입력해서 던지기</div>
        <div className="flex gap-2">
          <input
            value={instant}
            onChange={(e) => setInstant(e.target.value)}
            placeholder="예: 내일 회의 가능하세요?"
            className="flex-1 border-2 border-ink bg-paper px-3 py-2 font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && instant.trim()) run({ instantText: instant.trim() }, 'instant');
            }}
          />
          <button
            onClick={() => instant.trim() && run({ instantText: instant.trim() }, 'instant')}
            disabled={!!running || !instant.trim()}
            className="btn btn-primary"
          >
            {running === 'instant' ? '실행 중...' : '▶ 던지기'}
          </button>
        </div>
      </div>

      {/* 예시 5개 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shared.map((f) => (
          <div key={f.id} className="brut-tight bg-paper p-3 flex flex-col">
            <div className="font-mono text-[10px] uppercase text-muted">{f.channelName} · {f.userName}</div>
            <div className="text-sm mt-1 mb-3 flex-1 line-clamp-3">{f.text}</div>
            <button
              onClick={() => run({ fixtureId: f.id }, f.id)}
              disabled={!!running}
              className="btn justify-center text-xs w-full"
            >
              {running === f.id ? '실행 중...' : '▶ 이걸로 테스트'}
            </button>
          </div>
        ))}
      </div>

      {/* 결과 */}
      {lastResult && (
        <div className={`brut p-4 mt-4 ${lastResult.status === 'success' ? '' : 'bg-rust/10'}`}>
          <div className="flex items-center justify-between font-mono text-xs uppercase mb-2">
            <span>{lastResult.status === 'success' ? '✅ 성공' : '❌ ' + lastResult.status}</span>
            <span className="text-muted">
              {fmtDuration(lastResult.durationMs)} · {fmtCurrency(lastResult.costUsd)}
            </span>
          </div>
          {lastResult.error ? (
            <div className="text-rust text-sm font-mono">{lastResult.error}</div>
          ) : (
            <pre className="text-xs font-mono bg-sand p-3 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(lastResult.result, null, 2)}
            </pre>
          )}
          <div className="text-[10px] text-muted mt-2">
            💡 텔레그램이 연결돼 있으면 실제 알림도 갔어요. 텔레그램 확인해보세요!
          </div>
        </div>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════
// 섹션 3: 실제로 동작하고 있어요! (telegram + slack 채팅 타임라인)
// ═════════════════════════════════════════════════════════
function SectionLiveActivity({ agentName }: { agentName: string }) {
  const [flow, setFlow] = useState<FlowItem[]>([]);

  useEffect(() => {
    const load = () =>
      fetch(`/api/runtime/feed/mentions?agent=${encodeURIComponent(agentName)}&limit=30`)
        .then((r) => r.json())
        .then((d: { flow?: FlowItem[] }) => setFlow(d.flow ?? []))
        .catch(() => {});
    load();
    const i = setInterval(load, 8_000);
    return () => clearInterval(i);
  }, [agentName]);

  return (
    <section className="mb-10">
      <SectionHeader
        emoji="📡"
        title="실제로 동작하고 있어요!"
        sub="실제 슬랙 멘션을 받아서 텔레그램으로 보낸 기록 (채팅처럼)"
      />

      {flow.length === 0 ? (
        <div className="brut p-6 text-center text-muted">
          <div className="text-3xl mb-2">📭</div>
          아직 실제로 처리한 멘션이 없어요.
          <div className="text-xs mt-1">
            슬랙에서 멘션을 받거나, 위에서 테스트를 돌려보세요.
          </div>
        </div>
      ) : (
        <div className="brut p-0 overflow-hidden">
          <div className="divide-y-2 divide-ink max-h-[560px] overflow-y-auto">
            {flow.map((item, i) => (
              <div key={item.telegram.id} className="p-4 fade-up" style={{ animationDelay: `${i * 30}ms` }}>
                <div className="font-mono text-[10px] uppercase text-muted mb-2 text-right">
                  {fmtRelativeTime(item.telegram.sentAt)}
                </div>
                {/* 슬랙 — 왼쪽 말풍선 */}
                {item.slack && (
                  <div className="flex justify-start mb-2">
                    <div className="max-w-[80%] brut-tight bg-paper p-3">
                      <div className="font-mono text-[10px] uppercase text-muted mb-1">
                        💬 슬랙 {item.slack.channelName && `· #${item.slack.channelName}`}
                        {item.slack.userName && ` · ${item.slack.userName}`}
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words">{item.slack.text}</div>
                    </div>
                  </div>
                )}
                {/* 텔레그램 — 오른쪽 말풍선 */}
                <div className="flex justify-end">
                  <div className="max-w-[80%] bg-ink text-paper p-3">
                    <div className="font-mono text-[10px] uppercase opacity-70 mb-1">📱 텔레그램</div>
                    <div className="text-sm whitespace-pre-wrap break-words">{item.telegram.text}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════
// helpers
// ═════════════════════════════════════════════════════════
function SectionHeader({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-display font-extrabold text-2xl flex items-center gap-2">
        <span>{emoji}</span>
        {title}
      </h2>
      <p className="text-muted text-sm mt-0.5">{sub}</p>
    </div>
  );
}

function toolEmoji(id: string): string {
  if (id.startsWith('slack')) return '💬';
  if (id.startsWith('telegram')) return '📱';
  if (id.startsWith('llm')) return '🧠';
  return '🔧';
}

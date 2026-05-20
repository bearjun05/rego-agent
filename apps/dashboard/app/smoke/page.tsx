'use client';
import { useEffect, useState } from 'react';
import { fmtRelativeTime, fmtCurrency, fmtDuration } from '@/lib/utils';

interface Fixture {
  id: string;
  title: string;
  text: string;
  channelName?: string;
  userName?: string;
  expectedCategory?: string;
}
interface UserFixture {
  id: string;
  title: string;
  payload: { text: string; channelName?: string; userName?: string };
  scope: string;
  ownerAgent: string | null;
  createdBy: string | null;
}

interface AgentSummary {
  name: string;
  displayName: string | null;
  icon: string;
}

interface SmokeResult {
  result: {
    runId: string;
    agentName: string;
    status: string;
    durationMs: number;
    costUsd: number;
    result?: unknown;
    error?: string;
  };
  fixture: { id: string };
}

export default function SmokePage() {
  const [shared, setShared] = useState<Fixture[]>([]);
  const [userFixtures, setUserFixtures] = useState<UserFixture[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [targetAgent, setTargetAgent] = useState<string>('');
  const [instantText, setInstantText] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [recent, setRecent] = useState<Array<{ id: number; agentName: string; fixtureId: string; passed: boolean | null; output: unknown; createdAt: string; durationMs: number | null; costUsd: string }>>([]);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<SmokeResult | null>(null);
  const [newFix, setNewFix] = useState({
    id: '',
    title: '',
    text: '',
    expectedCategory: '',
  });

  useEffect(() => {
    fetch('/api/runtime/smoke/fixtures')
      .then((r) => r.json())
      .then((d: { shared?: Fixture[]; user?: UserFixture[] }) => {
        setShared(d.shared ?? []);
        setUserFixtures(d.user ?? []);
      });
    fetch('/api/runtime/agents')
      .then((r) => r.json())
      .then((d: { agents?: AgentSummary[] }) => {
        setAgents(d.agents ?? []);
        if (d.agents && d.agents.length > 0 && !targetAgent) setTargetAgent(d.agents[0].name);
      });
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRecent = () => {
    fetch('/api/runtime/smoke/results?limit=30')
      .then((r) => r.json())
      .then((d: { results?: typeof recent }) => setRecent(d.results ?? []));
  };

  const runFixture = async (fixtureId: string) => {
    if (!targetAgent) {
      alert('에이전트를 먼저 선택하세요');
      return;
    }
    setRunning(true);
    try {
      const res = await fetch('/api/runtime/smoke/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: targetAgent, fixtureId }),
      });
      const data = (await res.json()) as SmokeResult;
      setLastResult(data);
      loadRecent();
    } finally {
      setRunning(false);
    }
  };

  const runInstant = async () => {
    if (!targetAgent || !instantText.trim()) return;
    setRunning(true);
    try {
      const res = await fetch('/api/runtime/smoke/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: targetAgent, instantText: instantText.trim() }),
      });
      const data = (await res.json()) as SmokeResult;
      setLastResult(data);
      setInstantText('');
      loadRecent();
    } finally {
      setRunning(false);
    }
  };

  const runAll = async () => {
    if (!targetAgent) return;
    if (!confirm(`${targetAgent}에게 모든 fixture (${shared.length}개)를 실행할까요?`)) return;
    setRunning(true);
    try {
      await fetch('/api/runtime/smoke/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: targetAgent, triggeredBy: 'manual' }),
      });
      loadRecent();
    } finally {
      setRunning(false);
    }
  };

  const addFixture = async () => {
    if (!newFix.id || !newFix.title || !newFix.text) return;
    await fetch('/api/runtime/smoke/fixtures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newFix.id,
        title: newFix.title,
        text: newFix.text,
        expectedCategory: newFix.expectedCategory || undefined,
        scope: 'shared',
      }),
    });
    setNewFix({ id: '', title: '', text: '', expectedCategory: '' });
    setShowAddForm(false);
    const r = await fetch('/api/runtime/smoke/fixtures');
    const d = (await r.json()) as { user?: UserFixture[] };
    setUserFixtures(d.user ?? []);
  };

  return (
    <div className="max-w-[1400px] mx-auto pt-8">
      <div className="mb-8">
        <div className="font-mono text-xs uppercase text-muted">테스트</div>
        <h1 className="font-display font-extrabold text-4xl lg:text-5xl tracking-tight">
          SMOKE<span className="text-rust">.</span>
        </h1>
        <p className="text-muted text-sm mt-2">
          가상 슬랙 멘션을 본인 (또는 다른 사람) 에이전트에게 던져보고, 결과를 즉시 확인.
        </p>
      </div>

      {/* 컨트롤 패널 */}
      <div className="brut p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
          <div>
            <label className="font-mono text-xs uppercase text-muted block mb-1">테스트할 에이전트</label>
            <select
              value={targetAgent}
              onChange={(e) => setTargetAgent(e.target.value)}
              className="w-full border-2 border-ink bg-paper px-3 py-2 font-mono"
            >
              <option value="">선택...</option>
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.icon} {a.displayName ?? a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={runAll} disabled={running || !targetAgent} className="btn btn-dark">
              전체 fixture 실행
            </button>
          </div>
        </div>

        {/* Instant test */}
        <div className="mt-4">
          <label className="font-mono text-xs uppercase text-muted block mb-1">즉시 멘션 시뮬레이션</label>
          <div className="flex gap-2">
            <input
              value={instantText}
              onChange={(e) => setInstantText(e.target.value)}
              placeholder={`@${targetAgent || '에이전트'} 이거 어떻게 처리해주세요?`}
              className="flex-1 border-2 border-ink bg-paper px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={runInstant}
              disabled={running || !targetAgent || !instantText.trim()}
              className="btn btn-primary"
            >
              {running ? '실행 중...' : '▶ 실행'}
            </button>
          </div>
        </div>

        {lastResult && (
          <div className="mt-4 border-t-2 border-ink pt-4">
            <div className="font-mono text-xs uppercase mb-1">
              마지막 결과: {lastResult.result.status} ·{' '}
              {fmtDuration(lastResult.result.durationMs)} ·{' '}
              {fmtCurrency(lastResult.result.costUsd)}
            </div>
            {lastResult.result.error && (
              <div className="text-rust text-sm font-mono">{lastResult.result.error}</div>
            )}
            {lastResult.result.result !== undefined && (
              <pre className="text-xs font-mono mt-2 bg-sand p-2 overflow-x-auto">
                {JSON.stringify(lastResult.result.result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Fixture 카탈로그 */}
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display font-bold text-2xl">Fixture 카탈로그</h2>
        <button onClick={() => setShowAddForm((v) => !v)} className="btn">
          {showAddForm ? '취소' : '+ 새 fixture 추가'}
        </button>
      </div>

      {showAddForm && (
        <div className="brut p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              placeholder="id (예: my-question-1)"
              value={newFix.id}
              onChange={(e) => setNewFix({ ...newFix, id: e.target.value })}
              className="border-2 border-ink px-3 py-2 font-mono text-sm"
            />
            <input
              placeholder="제목 (예: 환불 문의 케이스)"
              value={newFix.title}
              onChange={(e) => setNewFix({ ...newFix, title: e.target.value })}
              className="border-2 border-ink px-3 py-2 font-mono text-sm"
            />
            <textarea
              placeholder="메시지 텍스트 (이 텍스트가 슬랙 멘션으로 들어옴)"
              value={newFix.text}
              onChange={(e) => setNewFix({ ...newFix, text: e.target.value })}
              className="border-2 border-ink px-3 py-2 font-mono text-sm md:col-span-2 min-h-[80px]"
            />
            <input
              placeholder="기대 카테고리 (선택, 예: question)"
              value={newFix.expectedCategory}
              onChange={(e) => setNewFix({ ...newFix, expectedCategory: e.target.value })}
              className="border-2 border-ink px-3 py-2 font-mono text-sm"
            />
            <button onClick={addFixture} className="btn btn-primary">
              추가
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {shared.map((f) => (
          <div key={f.id} className="brut p-3">
            <div className="font-mono text-[10px] uppercase text-muted">{f.id}</div>
            <div className="font-display font-bold mt-1">{f.title}</div>
            <div className="text-xs mt-2 line-clamp-3 text-muted">{f.text}</div>
            {f.expectedCategory && (
              <span className="inline-block font-mono text-[10px] uppercase bg-ink text-paper px-1.5 py-0.5 mt-2">
                expected: {f.expectedCategory}
              </span>
            )}
            <button
              onClick={() => runFixture(f.id)}
              disabled={running || !targetAgent}
              className="btn w-full mt-3 justify-center"
            >
              ▶ 실행
            </button>
          </div>
        ))}
        {userFixtures.map((f) => (
          <div key={f.id} className="brut p-3 bg-sand/30">
            <div className="font-mono text-[10px] uppercase text-muted flex justify-between">
              <span>{f.id}</span>
              <span className="text-rust">USER</span>
            </div>
            <div className="font-display font-bold mt-1">{f.title}</div>
            <div className="text-xs mt-2 line-clamp-3 text-muted">{f.payload.text}</div>
            <button
              onClick={() => runFixture(f.id)}
              disabled={running || !targetAgent}
              className="btn w-full mt-3 justify-center"
            >
              ▶ 실행
            </button>
          </div>
        ))}
      </div>

      {/* 최근 결과 */}
      <h2 className="font-display font-bold text-2xl mb-3">최근 스모크 결과</h2>
      <div className="brut p-0 overflow-hidden">
        <div className="divide-y-2 divide-ink max-h-[400px] overflow-y-auto">
          {recent.length === 0 && (
            <div className="p-6 text-center text-muted text-sm">아직 결과가 없어요.</div>
          )}
          {recent.map((r) => (
            <div key={r.id} className="p-3 flex items-center justify-between gap-2 flex-wrap hover:bg-sand transition-colors">
              <div className="flex items-baseline gap-2">
                <span className="text-lg">{r.passed ? '✅' : r.passed === false ? '❌' : '·'}</span>
                <span className="font-mono text-xs uppercase">{r.agentName}</span>
                <span className="font-mono text-xs text-muted">/ {r.fixtureId}</span>
              </div>
              <div className="font-mono text-xs text-muted">
                {fmtRelativeTime(r.createdAt)}
                {r.durationMs !== null && ` · ${fmtDuration(r.durationMs)}`}
                {` · ${fmtCurrency(parseFloat(r.costUsd))}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

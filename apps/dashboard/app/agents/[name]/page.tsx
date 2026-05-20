'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { fmtRelativeTime, fmtCurrency, fmtDuration } from '@/lib/utils';
import { MentionFlow } from '@/components/MentionFlow';

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
    manifest: {
      tools?: string[];
      triggers?: Array<{ type: string; channel?: string; emoji?: string; schedule?: string }>;
    } | null;
    updatedAt: string;
  };
  recentRuns: Array<{
    id: string;
    triggerType: string;
    status: string;
    durationMs: number | null;
    costUsd: string | null;
    startedAt: string;
    error: string | null;
  }>;
  totalCostUsd: number;
}

export default function AgentDetailPage() {
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);
  const [data, setData] = useState<AgentDetail | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`/api/runtime/agents/${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    load();
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
  }, [name]);

  if (!data) {
    return (
      <div className="max-w-[1200px] mx-auto pt-12 text-muted">
        <Link href="/" className="font-mono text-xs uppercase hover:underline">← 돌아가기</Link>
        <div className="mt-8">로딩 중...</div>
      </div>
    );
  }

  const a = data.agent;

  return (
    <div className="max-w-[1200px] mx-auto pt-8">
      <Link href="/" className="font-mono text-xs uppercase hover:underline">
        ← 모든 에이전트
      </Link>

      <div className="brut p-6 mt-4 mb-6" style={{ background: `${a.color}10` }}>
        <div className="flex flex-col lg:flex-row gap-6 lg:items-end justify-between">
          <div>
            <div className="text-6xl mb-2">{a.icon}</div>
            <h1 className="font-display font-extrabold text-4xl lg:text-5xl leading-none">
              {a.displayName ?? a.name}
            </h1>
            <div className="font-mono text-xs uppercase text-muted mt-2">
              @{a.name}
              {a.githubHandle && ` · github: ${a.githubHandle}`}
            </div>
            {a.description && (
              <p className="text-sm mt-3 max-w-lg">{a.description}</p>
            )}
            {a.isPaused && (
              <div className="mt-3 inline-block bg-rust text-paper px-3 py-1 font-mono text-xs uppercase">
                ⏸ 일시정지: {a.pausedReason ?? 'admin'}
              </div>
            )}
          </div>

          <div className="font-mono text-xs uppercase">
            <div className="border-l-2 border-ink pl-3 space-y-1">
              <div>
                <span className="text-muted">총 비용: </span>
                <span className="font-bold">{fmtCurrency(data.totalCostUsd)}</span>
              </div>
              <div>
                <span className="text-muted">상태: </span>
                {a.loaded ? '✓ 로드됨' : '✗ 미로드'}
              </div>
              <div>
                <span className="text-muted">업데이트: </span>
                {fmtRelativeTime(a.updatedAt)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 트리거 + 도구 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="brut p-4">
          <h3 className="font-display font-bold mb-3">트리거</h3>
          <div className="flex flex-wrap gap-2">
            {a.manifest?.triggers?.map((t, i) => (
              <span
                key={i}
                className="font-mono text-xs uppercase bg-ink text-paper px-2 py-1"
              >
                {t.type}
                {t.channel && ` #${t.channel}`}
                {t.emoji && ` ${t.emoji}`}
                {t.schedule && ` ⏰ ${t.schedule}`}
              </span>
            )) ?? <span className="text-muted text-sm">없음</span>}
          </div>
        </div>
        <div className="brut p-4">
          <h3 className="font-display font-bold mb-3">사용 도구</h3>
          <div className="flex flex-wrap gap-2">
            {a.manifest?.tools?.map((t, i) => (
              <span
                key={i}
                className="font-mono text-xs uppercase border-2 border-ink px-2 py-1"
              >
                {toolEmoji(t)} {t}
              </span>
            )) ?? <span className="text-muted text-sm">없음</span>}
          </div>
        </div>
      </div>

      {/* 멘션 플로우 (필터 자동) */}
      <div className="mb-6">
        <MentionFlowFiltered name={a.name} />
      </div>

      {/* 최근 실행 */}
      <div className="brut p-0 overflow-hidden">
        <div className="p-4 border-b-2 border-ink bg-ink text-paper">
          <h2 className="font-display font-bold text-lg">최근 실행 ({data.recentRuns.length})</h2>
        </div>
        <div className="divide-y-2 divide-ink max-h-[420px] overflow-y-auto">
          {data.recentRuns.length === 0 && (
            <div className="p-6 text-center text-muted text-sm">아직 실행 이력이 없어요.</div>
          )}
          {data.recentRuns.map((r) => (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className="block p-3 hover:bg-sand transition-colors"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{statusIcon(r.status)}</span>
                  <span className="font-mono text-xs uppercase">{r.triggerType}</span>
                  <span className="font-mono text-[10px] uppercase text-muted">
                    {r.id.slice(0, 8)}
                  </span>
                </div>
                <div className="font-mono text-xs text-muted">
                  {fmtRelativeTime(r.startedAt)} ·{' '}
                  {r.durationMs !== null && fmtDuration(r.durationMs)} ·{' '}
                  {r.costUsd && fmtCurrency(parseFloat(r.costUsd))}
                </div>
              </div>
              {r.error && (
                <div className="text-xs text-rust mt-1 font-mono">{r.error.slice(0, 200)}</div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MentionFlowFiltered({ name }: { name: string }) {
  // Reuse MentionFlow with default filter
  return <MentionFlow />;
}

function statusIcon(s: string) {
  switch (s) {
    case 'success':
      return '✅';
    case 'failed':
      return '❌';
    case 'timeout':
      return '⏱';
    case 'aborted':
      return '⛔';
    case 'running':
      return '▶';
    default:
      return '·';
  }
}

function toolEmoji(id: string): string {
  if (id.startsWith('slack')) return '💬';
  if (id.startsWith('telegram')) return '📱';
  if (id.startsWith('llm')) return '🧠';
  return '🔧';
}

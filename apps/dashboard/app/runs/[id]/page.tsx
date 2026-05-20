'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { fmtCurrency, fmtDuration, fmtRelativeTime } from '@/lib/utils';

interface RunDetail {
  run: {
    id: string;
    agentName: string;
    triggerType: string;
    triggerPayload: unknown;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    costUsd: string;
    result: unknown;
    error: string | null;
  };
  llms: Array<{
    id: number;
    model: string;
    purpose: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
    durationMs: number | null;
    promptPreview: string | null;
    responsePreview: string | null;
  }>;
  tools: Array<{
    id: number;
    toolId: string;
    input: unknown;
    output: unknown;
    error: string | null;
    durationMs: number | null;
  }>;
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<RunDetail | null>(null);

  useEffect(() => {
    fetch(`/api/runtime/feed/runs/${params.id}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [params.id]);

  if (!data) return <div className="pt-12 text-center text-muted">로딩...</div>;

  const r = data.run;

  return (
    <div className="max-w-[1200px] mx-auto pt-8">
      <Link href={`/agents/${encodeURIComponent(r.agentName)}`} className="font-mono text-xs uppercase hover:underline">
        ← {r.agentName}
      </Link>

      <div className="brut p-4 mt-4 mb-6">
        <div className="font-mono text-[10px] uppercase text-muted">RUN</div>
        <div className="font-mono text-sm break-all">{r.id}</div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
          <div>
            <div className="text-muted uppercase text-[10px]">trigger</div>
            <div className="font-bold">{r.triggerType}</div>
          </div>
          <div>
            <div className="text-muted uppercase text-[10px]">status</div>
            <div className="font-bold">{r.status}</div>
          </div>
          <div>
            <div className="text-muted uppercase text-[10px]">duration</div>
            <div className="font-bold">{r.durationMs !== null && fmtDuration(r.durationMs)}</div>
          </div>
          <div>
            <div className="text-muted uppercase text-[10px]">cost</div>
            <div className="font-bold">{fmtCurrency(parseFloat(r.costUsd))}</div>
          </div>
        </div>
        {r.error && (
          <div className="mt-4 bg-rust/20 border-2 border-rust p-3 font-mono text-xs">
            <div className="text-rust uppercase font-bold mb-1">ERROR</div>
            {r.error}
          </div>
        )}
      </div>

      {/* LLM 호출 */}
      {data.llms.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display font-bold text-xl mb-3">LLM 호출 ({data.llms.length})</h2>
          <div className="space-y-3">
            {data.llms.map((l) => (
              <div key={l.id} className="brut p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-mono text-xs uppercase">
                    🧠 {l.model} {l.purpose && `· ${l.purpose}`}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {l.inputTokens}↓ {l.outputTokens}↑ · {fmtCurrency(parseFloat(l.costUsd))} ·{' '}
                    {l.durationMs !== null && fmtDuration(l.durationMs)}
                  </span>
                </div>
                {l.promptPreview && (
                  <details className="text-xs font-mono">
                    <summary className="cursor-pointer text-muted">PROMPT</summary>
                    <pre className="bg-sand p-2 mt-1 overflow-x-auto whitespace-pre-wrap">{l.promptPreview}</pre>
                  </details>
                )}
                {l.responsePreview && (
                  <details className="text-xs font-mono mt-1">
                    <summary className="cursor-pointer text-muted">RESPONSE</summary>
                    <pre className="bg-sand p-2 mt-1 overflow-x-auto whitespace-pre-wrap">{l.responsePreview}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tool 호출 */}
      {data.tools.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display font-bold text-xl mb-3">도구 호출 ({data.tools.length})</h2>
          <div className="space-y-3">
            {data.tools.map((t) => (
              <div key={t.id} className="brut p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-mono text-xs uppercase">
                    🔧 {t.toolId}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {t.durationMs !== null && fmtDuration(t.durationMs)}
                  </span>
                </div>
                {t.error && (
                  <div className="text-rust text-xs font-mono">{t.error}</div>
                )}
                <details className="text-xs font-mono">
                  <summary className="cursor-pointer text-muted">INPUT/OUTPUT</summary>
                  <pre className="bg-sand p-2 mt-1 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify({ input: t.input, output: t.output }, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trigger payload */}
      <section>
        <h2 className="font-display font-bold text-xl mb-3">Trigger Payload</h2>
        <pre className="brut p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(r.triggerPayload, null, 2)}
        </pre>
      </section>
    </div>
  );
}

'use client';
import { useState } from 'react';

interface ReloadResult {
  ok: boolean;
  sha?: string;
  branch?: string;
  cronCount?: number;
  error?: string;
  stage?: string;
}

export function ReloadButton({
  agentSlug,
  onComplete,
}: {
  agentSlug: string;
  onComplete?: (result: ReloadResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReloadResult | null>(null);

  const handle = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(
        `/api/runtime/agents/${encodeURIComponent(agentSlug)}/reload`,
        { method: 'POST' },
      );
      const data = (await r.json()) as ReloadResult;
      setResult(data);
      onComplete?.(data);
    } catch (e) {
      const err: ReloadResult = { ok: false, error: (e as Error).message };
      setResult(err);
      onComplete?.(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brut p-3 stud">
      <div className="font-display font-bold text-sm mb-1">⚡ 내 코드 적용하기</div>
      <div className="font-mono text-[11px] text-muted mb-2 leading-relaxed">
        본인 브랜치(<code className="px-1 bg-sand">learner/{agentSlug}</code>)에서 최신 코드를 가져와 즉시 반영합니다.
      </div>
      <button
        onClick={handle}
        disabled={busy}
        className={`btn btn-dark text-xs ${busy ? 'animate-pulse' : ''}`}
      >
        {busy ? (
          <>
            <span className="inline-flex gap-0.5 mr-1">
              <span className="w-1 h-3 bg-paper" />
              <span className="w-1 h-3 bg-paper opacity-60" />
              <span className="w-1 h-3 bg-paper opacity-30" />
            </span>
            적용 중…
          </>
        ) : (
          '내 코드 적용'
        )}
      </button>
      {result && (
        <div className={`mt-2 font-mono text-[10px] ${result.ok ? '' : 'text-rust'} whitespace-pre-wrap`}>
          {result.ok
            ? `✅ ${result.sha?.slice(0, 8)} 반영 (cron ${result.cronCount ?? 0})`
            : `❌ ${result.stage}: ${result.error}`}
        </div>
      )}
    </div>
  );
}

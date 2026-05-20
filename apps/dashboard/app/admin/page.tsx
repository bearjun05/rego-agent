'use client';
import { useEffect, useState } from 'react';
import { fmtRelativeTime } from '@/lib/utils';

interface AuditRow {
  id: number;
  action: string;
  actor: string | null;
  agentName: string | null;
  details: unknown;
  severity: string;
  createdAt: string;
}

interface AgentSummary {
  name: string;
  displayName: string | null;
  icon: string;
  isPaused: boolean;
  pausedReason: string | null;
}

export default function AdminPage() {
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [aRes, gRes] = await Promise.all([
          fetch(`/api/runtime/feed/audit?limit=100${severityFilter !== 'all' ? `&severity=${severityFilter}` : ''}`),
          fetch('/api/runtime/agents'),
        ]);
        const a = (await aRes.json()) as { audit?: AuditRow[] };
        const g = (await gRes.json()) as { agents?: AgentSummary[] };
        setAudit(a.audit ?? []);
        setAgents(g.agents ?? []);
      } catch {}
    };
    load();
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
  }, [severityFilter]);

  const pause = async (name: string) => {
    setBusy(true);
    try {
      const reason = prompt(`${name} 일시정지 사유:`) ?? 'admin paused';
      await fetch(`/api/runtime/agents/${encodeURIComponent(name)}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      setAgents((prev) => prev.map((p) => (p.name === name ? { ...p, isPaused: true, pausedReason: reason } : p)));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (name: string) => {
    setBusy(true);
    try {
      await fetch(`/api/runtime/agents/${encodeURIComponent(name)}/resume`, {
        method: 'POST',
      });
      setAgents((prev) => prev.map((p) => (p.name === name ? { ...p, isPaused: false, pausedReason: null } : p)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto pt-8">
      <div className="mb-8">
        <div className="font-mono text-xs uppercase text-muted">관리자 전용</div>
        <h1 className="font-display font-extrabold text-4xl lg:text-5xl tracking-tight">
          ADMIN<span className="text-rust">.</span>
        </h1>
        <p className="text-muted text-sm mt-2">에이전트 일시정지, 감사 로그</p>
      </div>

      {/* 에이전트 제어 */}
      <section className="mb-10">
        <h2 className="font-display font-bold text-2xl mb-4">에이전트 제어</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {agents.map((a) => (
            <div key={a.name} className={`brut p-3 ${a.isPaused ? 'bg-rust/10' : ''}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-2xl">{a.icon}</div>
                  <div className="font-display font-bold">{a.displayName ?? a.name}</div>
                  <div className="font-mono text-[10px] uppercase text-muted">@{a.name}</div>
                </div>
                {a.isPaused ? (
                  <button
                    disabled={busy}
                    onClick={() => resume(a.name)}
                    className="btn btn-primary text-[10px]"
                  >
                    재개
                  </button>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => pause(a.name)}
                    className="btn text-[10px]"
                  >
                    정지
                  </button>
                )}
              </div>
              {a.isPaused && (
                <div className="font-mono text-[10px] text-rust">사유: {a.pausedReason}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Audit log */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display font-bold text-2xl">감사 로그 (영구)</h2>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="font-mono text-xs uppercase border-2 border-ink px-2 py-1 bg-paper"
          >
            <option value="all">모두</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="critical">CRITICAL</option>
          </select>
        </div>

        <div className="brut p-0 overflow-hidden">
          <div className="divide-y-2 divide-ink max-h-[640px] overflow-y-auto">
            {audit.length === 0 && (
              <div className="p-6 text-center text-muted">로그가 없어요.</div>
            )}
            {audit.map((r) => (
              <div key={r.id} className="p-3 hover:bg-sand transition-colors">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`font-mono text-[10px] uppercase px-1.5 py-0.5 ${severityClass(r.severity)}`}>
                      {r.severity}
                    </span>
                    <span className="font-mono text-xs">{r.action}</span>
                    {r.agentName && (
                      <span className="font-mono text-xs text-muted">@{r.agentName}</span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-muted">
                    {fmtRelativeTime(r.createdAt)} · by {r.actor ?? 'system'}
                  </span>
                </div>
                {r.details !== null && (
                  <pre className="text-[10px] font-mono text-muted overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(r.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function severityClass(s: string) {
  switch (s) {
    case 'critical':
      return 'bg-rust text-paper';
    case 'warn':
      return 'bg-ink text-paper';
    default:
      return 'border border-ink';
  }
}

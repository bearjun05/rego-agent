'use client';
import { useEffect, useState } from 'react';
import { Markdown } from './Markdown';

interface Fixture {
  id: string;
  title: string;
  text: string;
  expectedCategory?: string;
}

interface SmokeRunResult {
  passed: boolean;
  status: string;
  durationMs: number;
  telegramSent?: string[];
  error?: string;
}

/**
 * 코드 적용 완료 후 자동으로 띄우는 스모크 테스트 카드.
 * - 공유 fixture 중 랜덤 2개 노출 (클릭 → 즉시 실행)
 * - "직접 만들기" 버튼 → 입력 모드 (부모가 채팅창 활성화)
 *
 * 부모(HomeChat)가 activeSmokeMode를 통해 입력 모드를 관리.
 */
export function SmokeTestCard({
  agentSlug,
  onPickWriteOwn,
  onResult,
}: {
  agentSlug: string;
  onPickWriteOwn: () => void;
  onResult?: (result: SmokeRunResult & { fixtureTitle: string; sentText?: string }) => void;
}) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [running, setRunning] = useState<string | null>(null); // 실행 중 fixtureId

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/runtime/smoke/fixtures');
        const data = (await r.json()) as { shared?: Fixture[] };
        const shared = data.shared ?? [];
        // 랜덤 2개
        const shuffled = [...shared].sort(() => Math.random() - 0.5);
        setFixtures(shuffled.slice(0, 2));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const runFixture = async (f: Fixture) => {
    setRunning(f.id);
    try {
      const r = await fetch('/api/runtime/smoke/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: agentSlug, fixtureId: f.id }),
      });
      const data = (await r.json()) as {
        result?: { status: string; durationMs: number };
        telegramSent?: string[];
        error?: string;
      };
      onResult?.({
        passed: data.result?.status === 'success',
        status: data.result?.status ?? 'unknown',
        durationMs: data.result?.durationMs ?? 0,
        telegramSent: data.telegramSent,
        fixtureTitle: f.title,
        sentText: data.telegramSent?.[0],
        error: data.error,
      });
    } catch (err) {
      onResult?.({
        passed: false,
        status: 'error',
        durationMs: 0,
        fixtureTitle: f.title,
        error: (err as Error).message,
      });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="brut p-3 bg-paper">
      <div className="font-display font-bold text-sm mb-1">🧪 테스트해볼까요?</div>
      <div className="font-mono text-[11px] text-muted mb-3 leading-relaxed">
        실제 슬랙 멘션이 오면 본인 에이전트가 어떻게 동작하는지 시뮬레이션해봐요.
      </div>

      <div className="space-y-2 mb-3">
        {fixtures.map((f) => (
          <button
            key={f.id}
            onClick={() => runFixture(f)}
            disabled={!!running}
            className="w-full text-left border-2 border-line bg-sand hover:bg-paper p-2 transition-colors disabled:opacity-50"
          >
            <div className="font-display font-bold text-[12px] mb-0.5 flex items-center gap-1.5">
              <span>💬</span>
              <span>{f.title}</span>
              {running === f.id && (
                <span className="ml-auto font-mono text-[9px] text-muted">실행 중…</span>
              )}
            </div>
            <div className="font-mono text-[10px] text-muted line-clamp-2 leading-snug">
              "{f.text}"
            </div>
          </button>
        ))}
        {fixtures.length === 0 && (
          <div className="font-mono text-[10px] text-muted py-2 text-center">
            테스트 메시지 로딩 중…
          </div>
        )}
      </div>

      <button
        onClick={onPickWriteOwn}
        disabled={!!running}
        className="w-full btn btn-dark text-xs disabled:opacity-50"
      >
        ✏️ 직접 메시지 만들기
      </button>
    </div>
  );
}

/**
 * 스모크 실행 결과 — 텔레그램으로 어떻게 보냈는지 미리보기.
 */
export function SmokeResultCard({
  fixtureTitle,
  passed,
  durationMs,
  sentText,
  error,
}: {
  fixtureTitle: string;
  passed: boolean;
  durationMs: number;
  sentText?: string;
  error?: string;
}) {
  return (
    <div className={`brut p-3 ${passed ? 'bg-paper' : 'bg-sand'}`}>
      <div className="font-display font-bold text-sm mb-1 flex items-center gap-2">
        <span>{passed ? '✅' : '⚠'}</span>
        <span className="truncate">{fixtureTitle}</span>
        <span className="ml-auto font-mono text-[10px] text-muted">{durationMs}ms</span>
      </div>
      {error && (
        <div className="font-mono text-[11px] text-rust mb-1 whitespace-pre-wrap">
          {error}
        </div>
      )}
      {sentText ? (
        <>
          <div className="font-mono text-[9px] uppercase text-muted mb-1 mt-2">
            📱 텔레그램으로 보낸 메시지
          </div>
          <div className="border-2 border-line bg-sand p-2 text-[12px] leading-relaxed">
            <Markdown text={sentText} />
          </div>
        </>
      ) : passed ? (
        <div className="font-mono text-[10px] text-muted mt-1">
          (텔레그램 전송 없음 — 핸들러가 보내지 않았어요)
        </div>
      ) : null}
    </div>
  );
}

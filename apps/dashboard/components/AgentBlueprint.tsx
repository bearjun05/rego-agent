'use client';
import { toolLabel, toolCategoryColor } from '@/lib/tool-labels';

interface Blueprint {
  agent: string;
  displayName: string | null;
  triggers: string[];
  tools: string[];
  hasOnCron: boolean;
  hasOnTelegramCallback: boolean;
  handlerLines: number;
  effectiveLines?: number;
  stats: {
    runs: number;
    toolCalls: number;
    telegramSent: number;
    llmCost: number;
  };
}

/** 트리거 type을 친숙 라벨 + 색으로 */
function triggerMeta(type: string): { label: string; color: string } {
  if (type === 'slack.mention' || type === 'slack') {
    return { label: '슬랙 멘션', color: 'var(--th-primary-1)' };
  }
  if (type === 'telegram.callback' || type === 'telegram') {
    return { label: '텔레그램 버튼', color: 'var(--th-primary-4)' };
  }
  if (type === 'cron') return { label: '정기 발화', color: 'var(--th-primary-2)' };
  if (type === 'manual') return { label: '수동 실행', color: 'var(--th-muted)' };
  if (type.startsWith('slack.')) return { label: `슬랙 · ${type.slice(6)}`, color: 'var(--th-primary-1)' };
  if (type.startsWith('telegram.')) return { label: `텔레그램 · ${type.slice(9)}`, color: 'var(--th-primary-4)' };
  return { label: type, color: 'var(--th-fg)' };
}

/**
 * 학습자 에이전트 청사진 — 트리거(왼쪽) → 핸들러(가운데) → 도구(오른쪽) 흐름.
 * SVG가 아니라 CSS grid + 절대좌표 SVG 연결선 조합으로 세련되게.
 */
export function AgentBlueprint({ blueprint }: { blueprint: Blueprint }) {
  const triggers = blueprint.triggers;
  const tools = blueprint.tools;
  const lines = blueprint.effectiveLines ?? blueprint.handlerLines;
  const handlers = [
    blueprint.hasOnCron && 'onCron',
    blueprint.hasOnTelegramCallback && 'onTelegramCallback',
  ].filter(Boolean) as string[];

  return (
    <div className="relative">
      {/* 배경 점선 그리드 */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, color-mix(in srgb, var(--th-fg) 14%, transparent) 1px, transparent 1.5px)',
          backgroundSize: '16px 16px',
          opacity: 0.6,
        }}
      />

      <div className="relative grid grid-cols-[1fr_auto_1fr] gap-6 items-center min-h-[200px] py-2">
        {/* ── 왼쪽: 트리거 ─────────────────────────── */}
        <div className="flex flex-col gap-2 items-stretch">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted">Trigger · 언제</div>
          {triggers.length === 0 ? (
            <EmptyPill text="(트리거 없음)" />
          ) : (
            triggers.map((t, i) => {
              const m = triggerMeta(t);
              return <BlockChip key={i} label={m.label} sub={t} accent={m.color} side="left" />;
            })
          )}
        </div>

        {/* ── 가운데: 핸들러 ─────────────────────────── */}
        <CoreBlock
          name={blueprint.displayName ?? blueprint.agent}
          lines={lines}
          handlers={handlers}
        />

        {/* ── 오른쪽: 도구 ─────────────────────────── */}
        <div className="flex flex-col gap-1.5 items-stretch">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted">Tools · 무엇으로</div>
          {tools.length === 0 ? (
            <EmptyPill text="(호출 도구 없음)" />
          ) : (
            tools.map((t, i) => {
              const meta = toolLabel(t);
              return (
                <BlockChip
                  key={i}
                  label={meta.label}
                  sub={t}
                  accent={toolCategoryColor(meta.category)}
                  side="right"
                  compact
                />
              );
            })
          )}
        </div>
      </div>

      {/* ── 흐름 화살표 (상단 좌→우) ─────────────────────────── */}
      <div className="relative mt-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-muted">
        <div className="flex-1 h-px" style={{ background: 'var(--th-fg)', opacity: 0.2 }} />
        <span>이벤트 받음</span>
        <span>→</span>
        <span>handler.ts 실행</span>
        <span>→</span>
        <span>외부 호출</span>
        <div className="flex-1 h-px" style={{ background: 'var(--th-fg)', opacity: 0.2 }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────── */

function CoreBlock({
  name,
  lines,
  handlers,
}: {
  name: string;
  lines: number;
  handlers: string[];
}) {
  const empty = lines === 0;
  return (
    <div
      className="relative px-5 py-4 text-center"
      style={{
        background: empty
          ? 'var(--th-card-bg)'
          : 'color-mix(in srgb, var(--th-primary-2) 14%, var(--th-card-bg))',
        border: '2px solid var(--th-fg)',
        boxShadow: '4px 4px 0 0 var(--th-fg)',
        borderRadius: 'var(--th-card-radius, 0)',
        minWidth: 180,
      }}
    >
      {/* 좌우 stud */}
      <span
        aria-hidden
        className="absolute -top-1.5 left-3 w-2.5 h-2.5 rounded-full"
        style={{ background: 'var(--th-primary-1)' }}
      />
      <span
        aria-hidden
        className="absolute -top-1.5 right-3 w-2.5 h-2.5 rounded-full"
        style={{ background: 'var(--th-primary-4)' }}
      />

      <div className="font-mono text-[9px] uppercase tracking-widest text-muted">Handler · 어떻게</div>
      <div className="font-display font-extrabold text-base leading-tight mt-0.5 truncate">
        {name}
      </div>
      <div className="font-mono text-[10px] text-muted mt-1 tabular-nums">
        {empty ? (
          <span className="italic">아직 시작 안 함</span>
        ) : (
          <>
            <span className="font-bold text-ink">{lines}</span>줄
          </>
        )}
      </div>
      {handlers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 justify-center">
          {handlers.map((h) => (
            <span
              key={h}
              className="font-mono text-[9px] px-1.5 py-0.5 border border-ink/60"
              style={{ background: 'var(--th-bg-alt, var(--th-card-bg))' }}
            >
              {h === 'onCron' ? '정기 발화' : h === 'onTelegramCallback' ? '버튼 콜백' : h}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BlockChip({
  label,
  sub,
  accent,
  side,
  compact,
}: {
  label: string;
  sub: string;
  accent: string;
  side: 'left' | 'right';
  compact?: boolean;
}) {
  return (
    <div
      className="relative px-2.5 py-1.5"
      style={{
        background: `color-mix(in srgb, ${accent} 14%, var(--th-card-bg))`,
        border: '1.5px solid var(--th-fg)',
        boxShadow: '2px 2px 0 0 var(--th-fg)',
        borderRadius: 'var(--th-card-radius, 0)',
      }}
    >
      {/* stud */}
      <span
        aria-hidden
        className={`absolute top-1 ${side === 'left' ? 'right-1.5' : 'left-1.5'} w-1.5 h-1.5 rounded-full`}
        style={{ background: accent }}
      />
      <div
        className={`font-display font-bold ${compact ? 'text-[12px]' : 'text-[13px]'} leading-tight truncate`}
      >
        {label}
      </div>
      <div className="font-mono text-[9px] text-muted truncate">{sub}</div>
    </div>
  );
}

function EmptyPill({ text }: { text: string }) {
  return (
    <div
      className="px-2.5 py-1.5 font-mono text-[10px] text-muted italic"
      style={{
        background: 'var(--th-card-bg)',
        border: '1.5px dashed color-mix(in srgb, var(--th-fg) 30%, transparent)',
        borderRadius: 'var(--th-card-radius, 0)',
      }}
    >
      {text}
    </div>
  );
}

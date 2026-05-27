'use client';
import { useState, useMemo } from 'react';
import { Markdown } from './Markdown';

/**
 * 인솔이가 챗 안에서 즉석으로 만드는 시각적 지식 카드 시스템.
 *
 * 사용법: LLM이 응답에 다음 토큰을 박으면 자동으로 카드 렌더.
 *   [[card:metric {"label":"멘션","value":"143","sub":"+12 오늘","tone":"primary"}]]
 *   [[card:chart {"title":"주간 처리량","data":[{"l":"월","v":3},{"l":"화","v":7}]}]]
 *   [[card:checklist {"title":"오늘 할 일","items":[{"t":"...","done":true},{"t":"..."}]}]]
 *   [[card:compare {"left":{"title":"슬랙","points":["...","..."]},"right":{"title":"텔레그램","points":["..."]}}]]
 *   [[card:timeline {"steps":[{"label":"수신","at":"14:22","done":true},{"label":"분류","at":"14:22"},{"label":"발송"}]}]]
 *   [[card:flow {"nodes":["슬랙 멘션","Claude 분류","Telegram 알림"]}]]
 *   [[card:callout {"tone":"info","title":"팁","body":"..."}]]
 *   [[card:quote {"text":"...","author":"창조주 준"}]]
 *
 * - JSON 파싱 실패해도 챗이 안 깨지게 안전 처리.
 * - 카드는 인터랙티브 (체크박스 토글, hover, 클릭 확장).
 * - 인솔이가 카드를 만들면 시각적으로 강조 (스튜드 + 좌측 컬러바).
 */

type CardKind =
  | 'metric'
  | 'chart'
  | 'checklist'
  | 'compare'
  | 'timeline'
  | 'flow'
  | 'callout'
  | 'quote';

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'card'; type: CardKind; data: unknown; raw: string };

/** 메시지 본문을 텍스트/카드 시퀀스로 분할. JSON 깨졌으면 텍스트로 강등. */
export function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[\[card:(metric|chart|checklist|compare|timeline|flow|callout|quote)\s+([\s\S]*?)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      const txt = content.slice(last, m.index).trim();
      if (txt) segments.push({ kind: 'text', text: txt });
    }
    const type = m[1] as CardKind;
    const jsonRaw = (m[2] ?? '').trim();
    try {
      const data = JSON.parse(jsonRaw);
      segments.push({ kind: 'card', type, data, raw: m[0]! });
    } catch {
      // 깨진 JSON — 원문 텍스트로 떨어트림
      segments.push({ kind: 'text', text: m[0]! });
    }
    last = m.index + m[0]!.length;
  }
  if (last < content.length) {
    const tail = content.slice(last).trim();
    if (tail) segments.push({ kind: 'text', text: tail });
  }
  if (segments.length === 0 && content) {
    segments.push({ kind: 'text', text: content });
  }
  return segments;
}

/** 메시지가 카드 토큰 하나라도 포함하면 true. (텍스트 버블 숨길 때 활용) */
export function hasCardToken(content: string): boolean {
  return /\[\[card:(metric|chart|checklist|compare|timeline|flow|callout|quote)\s/.test(content);
}

export function ChatCard({ type, data }: { type: CardKind; data: unknown }) {
  if (type === 'metric') return <MetricCard data={data as MetricData} />;
  if (type === 'chart') return <ChartCard data={data as ChartData} />;
  if (type === 'checklist') return <ChecklistCard data={data as ChecklistData} />;
  if (type === 'compare') return <CompareCard data={data as CompareData} />;
  if (type === 'timeline') return <TimelineCard data={data as TimelineData} />;
  if (type === 'flow') return <FlowCard data={data as FlowData} />;
  if (type === 'callout') return <CalloutCard data={data as CalloutData} />;
  if (type === 'quote') return <QuoteCard data={data as QuoteData} />;
  return null;
}

/* ──────────────────── shell ──────────────────── */
function CardShell({
  kind,
  tone = 'var(--th-primary-1)',
  children,
}: {
  kind: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="brut bg-paper relative overflow-hidden fade-up"
      style={{ borderLeftWidth: 6, borderLeftColor: tone }}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: tone, boxShadow: `0 0 0 3px color-mix(in srgb, ${tone} 30%, transparent)` }}
        />
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted">
          {kind}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/* ──────────────────── 1. METRIC ──────────────────── */
interface MetricData {
  label?: string;
  value?: string | number;
  sub?: string;
  tone?: 'primary' | 'rust' | 'green' | 'blue' | 'yellow';
  delta?: string; // "+3" / "-2"
}
const TONE_VAR: Record<NonNullable<MetricData['tone']>, string> = {
  primary: 'var(--th-primary-1)',
  rust: 'var(--th-accent)',
  green: 'var(--th-primary-4)',
  blue: 'var(--th-primary-1)',
  yellow: 'var(--th-primary-2)',
};
function MetricCard({ data }: { data: MetricData }) {
  const tone = TONE_VAR[data.tone ?? 'primary'];
  const positive = data.delta?.startsWith('+');
  return (
    <CardShell kind="metric" tone={tone}>
      <div className="flex items-baseline gap-3">
        <div
          className="font-display font-extrabold leading-none"
          style={{ fontSize: 48, color: tone }}
        >
          {data.value ?? '—'}
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {data.label ?? 'metric'}
          </div>
          {data.delta && (
            <div
              className="font-mono text-xs font-bold"
              style={{ color: positive ? 'var(--th-primary-4)' : 'var(--th-accent)' }}
            >
              {data.delta}
            </div>
          )}
        </div>
      </div>
      {data.sub && <div className="text-sm text-muted mt-2">{data.sub}</div>}
    </CardShell>
  );
}

/* ──────────────────── 2. CHART (mini bar) ──────────────────── */
interface ChartData {
  title?: string;
  data?: Array<{ l: string; v: number }>;
  unit?: string;
}
function ChartCard({ data }: { data: ChartData }) {
  const rows = data.data ?? [];
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <CardShell kind="chart" tone="var(--th-primary-3)">
      {data.title && <div className="font-display font-bold text-sm mb-2">{data.title}</div>}
      <div className="flex items-end gap-2 h-32">
        {rows.map((r, i) => {
          const h = Math.max(4, (r.v / max) * 100);
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="font-mono text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                {r.v}{data.unit ?? ''}
              </div>
              <div
                className="w-full transition-all hover:opacity-80"
                style={{
                  height: `${h}%`,
                  background: `var(--th-primary-${(i % 4) + 1})`,
                  border: '2px solid var(--th-fg)',
                  borderBottom: 'none',
                }}
              />
              <div className="font-mono text-[10px] text-muted">{r.l}</div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

/* ──────────────────── 3. CHECKLIST (인터랙티브) ──────────────────── */
interface ChecklistData {
  title?: string;
  items?: Array<{ t: string; done?: boolean }>;
}
function ChecklistCard({ data }: { data: ChecklistData }) {
  const initial = useMemo(
    () => (data.items ?? []).map((it) => ({ ...it, done: !!it.done })),
    [data.items],
  );
  const [items, setItems] = useState(initial);
  const doneCount = items.filter((i) => i.done).length;
  const toggle = (idx: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)));
  };
  return (
    <CardShell kind="checklist" tone="var(--th-primary-4)">
      {data.title && (
        <div className="flex items-baseline justify-between mb-2">
          <div className="font-display font-bold text-sm">{data.title}</div>
          <div className="font-mono text-[10px] text-muted">
            {doneCount}/{items.length}
          </div>
        </div>
      )}
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i}>
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-start gap-2 text-left px-2 py-1.5 hover:bg-sand transition-colors"
              style={{ borderRadius: 'var(--th-card-radius,0)' }}
            >
              <span
                aria-hidden
                className="mt-0.5 inline-flex items-center justify-center w-4 h-4 border-2 border-ink shrink-0"
                style={{ background: it.done ? 'var(--th-primary-4)' : 'transparent' }}
              >
                {it.done && <span className="text-[10px] leading-none">✓</span>}
              </span>
              <span className={`text-sm ${it.done ? 'line-through text-muted' : ''}`}>{it.t}</span>
            </button>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

/* ──────────────────── 4. COMPARE (좌우 대조) ──────────────────── */
interface CompareData {
  left?: { title?: string; points?: string[]; tone?: string };
  right?: { title?: string; points?: string[]; tone?: string };
}
function CompareCard({ data }: { data: CompareData }) {
  const L = data.left ?? {};
  const R = data.right ?? {};
  return (
    <CardShell kind="compare" tone="var(--th-primary-2)">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
        <ComparePane title={L.title} points={L.points} tone={L.tone ?? 'var(--th-primary-1)'} />
        <div className="hidden md:flex items-center justify-center font-display font-extrabold text-2xl text-muted">
          ⇄
        </div>
        <ComparePane title={R.title} points={R.points} tone={R.tone ?? 'var(--th-primary-3)'} />
      </div>
    </CardShell>
  );
}
function ComparePane({
  title,
  points,
  tone,
}: {
  title?: string;
  points?: string[];
  tone: string;
}) {
  return (
    <div
      className="p-3 border-2 border-ink"
      style={{ background: `color-mix(in srgb, ${tone} 12%, var(--th-card-bg))` }}
    >
      <div className="font-display font-bold text-sm mb-2" style={{ color: tone }}>
        {title ?? '—'}
      </div>
      <ul className="space-y-1 text-sm">
        {(points ?? []).map((p, i) => (
          <li key={i}>· {p}</li>
        ))}
      </ul>
    </div>
  );
}

/* ──────────────────── 5. TIMELINE ──────────────────── */
interface TimelineData {
  steps?: Array<{ label: string; at?: string; done?: boolean }>;
}
function TimelineCard({ data }: { data: TimelineData }) {
  const steps = data.steps ?? [];
  return (
    <CardShell kind="timeline" tone="var(--th-primary-1)">
      <ol className="relative pl-5 space-y-3">
        <div className="absolute left-1.5 top-1 bottom-1 w-0.5 bg-ink/30" />
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <span
              aria-hidden
              className="absolute -left-[18px] top-1 w-3 h-3 border-2 border-ink"
              style={{
                background: s.done ? 'var(--th-primary-4)' : 'var(--th-bg)',
                borderRadius: 'var(--th-stud-radius,2px)',
              }}
            />
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-sm font-display font-bold ${s.done ? '' : 'text-muted'}`}>
                {s.label}
              </span>
              {s.at && <span className="font-mono text-[10px] text-muted">{s.at}</span>}
            </div>
          </li>
        ))}
      </ol>
    </CardShell>
  );
}

/* ──────────────────── 6. FLOW (A → B → C) ──────────────────── */
interface FlowData {
  nodes?: string[];
  highlight?: number; // 현재 활성 노드 인덱스
}
function FlowCard({ data }: { data: FlowData }) {
  const nodes = data.nodes ?? [];
  return (
    <CardShell kind="flow" tone="var(--th-primary-3)">
      <div className="flex flex-wrap items-center gap-2">
        {nodes.map((n, i) => (
          <span key={i} className="flex items-center gap-2">
            <span
              className="px-3 py-2 border-2 border-ink font-display font-bold text-sm relative"
              style={{
                background:
                  data.highlight === i
                    ? `color-mix(in srgb, var(--th-primary-${(i % 4) + 1}) 30%, var(--th-card-bg))`
                    : 'var(--th-card-bg)',
                boxShadow: '2px 2px 0 0 var(--th-fg)',
              }}
            >
              <span
                aria-hidden
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                style={{ background: `var(--th-primary-${(i % 4) + 1})` }}
              />
              {n}
            </span>
            {i < nodes.length - 1 && (
              <span className="font-display font-extrabold text-xl text-muted">→</span>
            )}
          </span>
        ))}
      </div>
    </CardShell>
  );
}

/* ──────────────────── 7. CALLOUT ──────────────────── */
interface CalloutData {
  tone?: 'info' | 'warn' | 'success' | 'tip';
  title?: string;
  body?: string;
}
const CALLOUT_TONE: Record<NonNullable<CalloutData['tone']>, { tone: string; icon: string }> = {
  info: { tone: 'var(--th-primary-1)', icon: 'ℹ' },
  warn: { tone: 'var(--th-accent)', icon: '⚠' },
  success: { tone: 'var(--th-primary-4)', icon: '✓' },
  tip: { tone: 'var(--th-primary-2)', icon: '💡' },
};
function CalloutCard({ data }: { data: CalloutData }) {
  const t = CALLOUT_TONE[data.tone ?? 'info'];
  return (
    <CardShell kind={`callout · ${data.tone ?? 'info'}`} tone={t.tone}>
      <div className="flex items-start gap-3">
        <div
          className="font-display font-extrabold text-2xl shrink-0 leading-none"
          style={{ color: t.tone }}
          aria-hidden
        >
          {t.icon}
        </div>
        <div className="min-w-0">
          {data.title && <div className="font-display font-bold text-sm mb-1">{data.title}</div>}
          {data.body && (
            <div className="text-sm text-muted leading-relaxed">
              <Markdown text={data.body} />
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}

/* ──────────────────── 8. QUOTE ──────────────────── */
interface QuoteData {
  text?: string;
  author?: string;
}
function QuoteCard({ data }: { data: QuoteData }) {
  return (
    <CardShell kind="quote" tone="var(--th-primary-3)">
      <div className="relative pl-6 pr-2 py-1">
        <span
          aria-hidden
          className="absolute left-0 top-0 font-display font-extrabold text-4xl leading-none text-muted"
        >
          “
        </span>
        <blockquote className="font-display text-base leading-snug italic">{data.text}</blockquote>
        {data.author && (
          <div className="font-mono text-[10px] uppercase text-muted mt-2">— {data.author}</div>
        )}
      </div>
    </CardShell>
  );
}

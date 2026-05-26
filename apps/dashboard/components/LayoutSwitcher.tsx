'use client';
import { useEffect, useState } from 'react';
import { LAYOUTS, applyLayout, getInitialLayout, wireStyle, type LayoutDef } from '@/lib/layouts';

/**
 * 레이아웃 스위처 — 좌측 하단 fixed (테마 스위처는 우측 하단이라 충돌 없음).
 * 10개 미니 와이어프레임 그리드. 클릭 시 즉시 전환 + localStorage 저장.
 * URL ?layout=<id> 지원.
 */
export function LayoutSwitcher() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>('classic');

  useEffect(() => {
    const t = getInitialLayout();
    setActive(t);
    applyLayout(t);
  }, []);

  const pick = (id: string) => {
    setActive(id);
    applyLayout(id);
  };

  const current = LAYOUTS.find((l) => l.id === active) ?? LAYOUTS[0]!;

  return (
    <>
      {open && (
        <div
          className="fixed bottom-20 left-4 z-[9998] brut bg-paper p-3 max-h-[80vh] overflow-y-auto"
          style={{ width: 'min(420px, calc(100vw - 32px))' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-display font-bold text-sm">레이아웃 선택</div>
              <div className="font-mono text-[10px] text-muted">10개 · 구조만 바꿈 (색은 그대로)</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="font-mono text-xs px-2 py-1 border-2 border-ink hover:bg-sand"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {LAYOUTS.map((l) => (
              <LayoutButton key={l.id} layout={l} active={l.id === active} onPick={() => pick(l.id)} />
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-ink/20">
            <div className="font-mono text-[10px] text-muted">
              ?layout=&lt;id&gt; URL로도 적용. 새로고침해도 유지.
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 left-4 z-[9999] brut bg-paper px-3 py-2 flex items-center gap-2 font-mono text-xs"
        title="레이아웃 전환"
      >
        <MiniWire layout={current} size={18} />
        <span className="hidden sm:inline">{current.name}</span>
        <span className="text-muted">{open ? '▼' : '▲'}</span>
      </button>
    </>
  );
}

function LayoutButton({
  layout,
  active,
  onPick,
}: {
  layout: LayoutDef;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={`text-left p-2 border-2 transition-all ${
        active ? 'border-rust bg-sand' : 'border-ink hover:bg-sand'
      }`}
      style={{ borderRadius: 'var(--th-card-radius, 0)' }}
    >
      <div className="mb-1.5">
        <MiniWire layout={layout} size={56} showLabels />
      </div>
      <div className="font-display font-bold text-[11px] leading-tight">{layout.name}</div>
      <div className="font-mono text-[9px] text-muted mt-0.5 leading-tight">{layout.vibe}</div>
    </button>
  );
}

function MiniWire({
  layout,
  size,
  showLabels = false,
}: {
  layout: LayoutDef;
  size: number;
  showLabels?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="relative border-2 border-ink/70 bg-ink/5"
      style={{
        width: showLabels ? '100%' : size * 1.55,
        height: showLabels ? size * 1.55 : size,
        aspectRatio: showLabels ? '1.55 / 1' : undefined,
      }}
    >
      {layout.wire.map((zone, i) => (
        <div
          key={i}
          style={wireStyle(zone.area)}
          className="border border-ink/60 bg-paper/80 flex items-center justify-center overflow-hidden"
        >
          {showLabels && zone.label && (
            <span className="font-mono text-[7px] uppercase text-ink/70 px-1 truncate">
              {zone.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { THEMES, applyTheme, getInitialTheme, type ThemeDef } from '@/lib/themes';

/**
 * 디버그 모드 테마 스위처 — 우측 하단 fixed.
 * 펼치면 20개 swatch 그리드. 클릭 시 즉시 전환 + localStorage 저장.
 * URL ?theme=X 도 지원 (initial).
 */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>('brutalist');

  useEffect(() => {
    const t = getInitialTheme();
    setActive(t);
    applyTheme(t);
  }, []);

  const pick = (id: string) => {
    setActive(id);
    applyTheme(id);
  };

  const current = THEMES.find((t) => t.id === active) ?? THEMES[0]!;

  return (
    <>
      {/* 펼친 패널 */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-[9998] brut bg-paper p-3 max-h-[80vh] overflow-y-auto"
          style={{ width: 'min(360px, calc(100vw - 32px))' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-display font-bold text-sm">테마 선택</div>
              <div className="font-mono text-[10px] text-muted">20개 · 클릭하면 즉시 전환</div>
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
            {THEMES.map((t) => (
              <ThemeButton key={t.id} theme={t} active={t.id === active} onPick={() => pick(t.id)} />
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-ink/20">
            <div className="font-mono text-[10px] text-muted">
              ?theme=&lt;id&gt; URL로도 적용. 새로고침해도 유지.
            </div>
          </div>
        </div>
      )}

      {/* 토글 버튼 */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-[9999] brut bg-paper px-3 py-2 flex items-center gap-2 font-mono text-xs"
        title="테마 전환"
      >
        <span aria-hidden className="inline-flex gap-0.5">
          {current.swatches.map((c, i) => (
            <span
              key={i}
              className="block w-3 h-3"
              style={{ background: c, borderRadius: 'var(--th-card-radius, 0)' }}
            />
          ))}
        </span>
        <span className="hidden sm:inline">{current.name}</span>
        <span className="text-muted">{open ? '▼' : '▲'}</span>
      </button>
    </>
  );
}

function ThemeButton({
  theme,
  active,
  onPick,
}: {
  theme: ThemeDef;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={`text-left p-2 border-2 transition-all ${
        active
          ? 'border-rust bg-sand'
          : 'border-ink hover:bg-sand'
      }`}
      style={{ borderRadius: 'var(--th-card-radius, 0)' }}
    >
      <div className="flex gap-1 mb-1.5" aria-hidden>
        {theme.swatches.map((c, i) => (
          <span
            key={i}
            className="block w-full h-4"
            style={{ background: c, border: '1px solid rgba(0,0,0,0.1)' }}
          />
        ))}
      </div>
      <div className="font-display font-bold text-[11px] leading-tight">{theme.name}</div>
      <div className="font-mono text-[9px] text-muted mt-0.5 leading-tight">{theme.vibe}</div>
    </button>
  );
}

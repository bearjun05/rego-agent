'use client';
import { useEffect, useState } from 'react';

/**
 * 빙고 한 칸 완성 시 풀스크린 confetti rain.
 * fire={true}로 트리거 → 2.4초 후 자동 정리.
 */
export function CelebrationConfetti({
  trigger,
  duration = 2400,
}: {
  /** 변화 감지용 counter — ++ 할 때마다 한 번 발화 */
  trigger: number;
  duration?: number;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (trigger <= 0) return;
    setActive(true);
    const t = setTimeout(() => setActive(false), duration);
    return () => clearTimeout(t);
  }, [trigger, duration]);

  if (!active) return null;

  const colors = [
    'var(--th-accent)',
    'var(--th-primary-1)',
    'var(--th-primary-2)',
    'var(--th-primary-4)',
    'var(--th-primary-3)',
  ];

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[100]">
      {Array.from({ length: 60 }).map((_, i) => {
        const left = (i / 60) * 100 + Math.random() * 4;
        const delay = Math.random() * 600;
        const dur = 1800 + Math.random() * 1400;
        const color = colors[i % colors.length];
        const shape = i % 3;
        return (
          <span
            key={i}
            className="confetti-rain"
            style={{
              left: `${left}%`,
              top: -20,
              background: color,
              width: shape === 0 ? 8 : 10,
              height: shape === 1 ? 14 : 8,
              borderRadius: shape === 2 ? '50%' : '2px',
              animationDelay: `${delay}ms`,
              animationDuration: `${dur}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

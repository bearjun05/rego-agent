'use client';

/**
 * 빙고 9칸 완성 = "2주차 진입" 의 뜻으로 모든 UI에서 사용하는 금뱃지.
 * - 작은 inline 뱃지: 이름 옆 (사이즈 sm)
 * - 중간 뱃지: 채팅 헤더, 대시보드 카드 (사이즈 md)
 * - 큰 뱃지: 완성 축하 화면 (사이즈 lg)
 */

export type CellMap = Record<string, 'done' | 'pending'>;

/** 8개 빙고 라인 — 가로 3 + 세로 3 + 대각선 2 */
const BINGO_LINES: number[][] = [
  [1, 2, 3], [4, 5, 6], [7, 8, 9],
  [1, 4, 7], [2, 5, 8], [3, 6, 9],
  [1, 5, 9], [3, 5, 7],
];

export function countBingoLines(cells: CellMap | null | undefined): number {
  if (!cells) return 0;
  return BINGO_LINES.reduce(
    (acc, line) => acc + (line.every((n) => cells[String(n)] === 'done') ? 1 : 0),
    0,
  );
}

export function CompletionBadge({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const dim =
    size === 'sm'
      ? { w: 18, h: 18, fs: 10, br: 2 }
      : size === 'lg'
      ? { w: 56, h: 56, fs: 22, br: 6 }
      : { w: 28, h: 28, fs: 13, br: 3 };
  return (
    <span
      className="inline-flex items-center gap-1.5 align-middle"
      title={label ?? '빙고 9칸 완성 — 2주차 진입'}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center font-display font-extrabold leading-none shrink-0"
        style={{
          width: dim.w,
          height: dim.h,
          fontSize: dim.fs,
          background: 'linear-gradient(135deg, var(--th-primary-2) 0%, #E8B400 100%)',
          color: '#1A1300',
          border: `${dim.br > 3 ? 3 : 2}px solid var(--th-fg)`,
          borderRadius: dim.br,
          boxShadow: `${dim.br}px ${dim.br}px 0 0 var(--th-fg)`,
        }}
      >
        ★
      </span>
      {label && (
        <span
          className="font-mono uppercase tracking-widest"
          style={{ fontSize: size === 'lg' ? 12 : size === 'md' ? 10 : 9 }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

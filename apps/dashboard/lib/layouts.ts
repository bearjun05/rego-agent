/**
 * 레이아웃 카탈로그 — 10종.
 * 테마(컬러)와 직교 — `<html data-layout=...>` 속성으로 구조 변형만 적용.
 * - id: data-layout 값
 * - name/vibe: 픽커 라벨
 * - wire: 픽커 썸네일에 그리는 미니 와이어프레임 (CSS grid 또는 absolute zones)
 */

export type LayoutZone = {
  /** grid area 이름 또는 좌표 (0~1 비율) */
  area: string;
  /** 라벨 (와이어 미니뷰에 표시) */
  label?: string;
};

export interface LayoutDef {
  id: string;
  name: string;
  vibe: string;
  wire: LayoutZone[]; // 썸네일용 그리드/박스 정의
}

export const LAYOUTS: LayoutDef[] = [
  {
    id: 'classic',
    name: '클래식 스택',
    vibe: '히어로 → 챗 → 모니터, 단일 컬럼',
    wire: [
      { area: '0,0,100,22', label: 'HERO' },
      { area: '0,24,100,68', label: 'CHAT' },
      { area: '0,72,100,90', label: 'MON' },
    ],
  },
  {
    id: 'rail-right',
    name: '라이트 레일',
    vibe: 'Linear식 — 우측 챗 고정, 좌측 워크스페이스',
    wire: [
      { area: '0,0,62,28', label: 'HERO' },
      { area: '0,32,62,90', label: 'MON / FEED' },
      { area: '66,0,100,90', label: 'CHAT▎' },
    ],
  },
  {
    id: 'bento',
    name: '벤또 그리드',
    vibe: 'Apple식 — 비대칭 타일 그리드',
    wire: [
      { area: '0,0,60,40', label: 'HERO' },
      { area: '64,0,100,40', label: 'STREAK' },
      { area: '0,44,40,90', label: 'MON' },
      { area: '44,44,100,90', label: 'CHAT' },
    ],
  },
  {
    id: 'three-pane',
    name: '쓰리 페인',
    vibe: 'Notion/Figma — 좌 nav / 중 콘텐츠 / 우 인스펙터',
    wire: [
      { area: '0,0,22,90', label: 'NAV' },
      { area: '24,0,68,28', label: 'HERO' },
      { area: '24,32,68,90', label: 'CHAT' },
      { area: '72,0,100,90', label: 'INSP' },
    ],
  },
  {
    id: 'floating',
    name: '플로팅 캔버스',
    vibe: 'Arc식 — 풀블리드 캔버스, 챗은 드래그 가능한 창',
    wire: [
      { area: '0,0,100,90', label: 'CANVAS (full-bleed)' },
      { area: '54,52,96,86', label: '⌘ CHAT (float)' },
    ],
  },
  {
    id: 'command',
    name: '커맨드 팰릿',
    vibe: 'Raycast식 — 미니멀, ⌘K로 모든 것',
    wire: [
      { area: '0,0,100,32', label: 'HERO (compact)' },
      { area: '20,38,80,62', label: '⌘K  PROMPT' },
      { area: '0,72,100,90', label: '   RESULT FEED   ' },
    ],
  },
  {
    id: 'kanban',
    name: '칸반 컬럼',
    vibe: 'Trello식 — 이번주/진행/완료 + 도킹된 챗',
    wire: [
      { area: '0,0,100,12', label: 'HERO line' },
      { area: '0,16,32,72', label: 'TODO' },
      { area: '34,16,66,72', label: 'DOING' },
      { area: '68,16,100,72', label: 'DONE' },
      { area: '0,76,100,90', label: ' CHAT DOCK ' },
    ],
  },
  {
    id: 'stacked-feed',
    name: '피드',
    vibe: 'ChatGPT 모바일식 — 좁은 단일 컬럼',
    wire: [
      { area: '25,0,75,16', label: 'HERO' },
      { area: '25,20,75,42', label: 'CHAT' },
      { area: '25,46,75,62', label: '— MENTION —' },
      { area: '25,66,75,82', label: '— RUN —' },
      { area: '25,86,75,90', label: '— TODO —' },
    ],
  },
  {
    id: 'magazine',
    name: '매거진',
    vibe: '에디토리얼 — 큰 히어로 + 비대칭 콘텐츠 블록',
    wire: [
      { area: '0,0,68,54', label: 'COVER STORY' },
      { area: '72,0,100,26', label: 'KICKER' },
      { area: '72,30,100,54', label: 'SIDE' },
      { area: '0,58,46,90', label: 'CHAT' },
      { area: '50,58,100,90', label: 'MON' },
    ],
  },
  {
    id: 'tabbed',
    name: '탭 워크스페이스',
    vibe: 'VS Code식 — 상단 탭, 본문 단일 패널',
    wire: [
      { area: '0,0,100,8', label: ' 챗 │ 빙고 │ 4축 │ 모니터 ' },
      { area: '0,12,100,90', label: '◀ active tab content ▶' },
    ],
  },
];

export const DEFAULT_LAYOUT = 'classic';
const LS_KEY = 'rego-layout';

export function applyLayout(id: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.layout = id;
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {}
}

export function getInitialLayout(): string {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('layout');
    if (fromUrl && LAYOUTS.some((l) => l.id === fromUrl)) return fromUrl;
    const stored = localStorage.getItem(LS_KEY);
    if (stored && LAYOUTS.some((l) => l.id === stored)) return stored;
  } catch {}
  return DEFAULT_LAYOUT;
}

/** wire 좌표(0~100 비율) → CSS top/left/right/bottom 스타일 */
export function wireStyle(area: string): React.CSSProperties {
  const [x1, y1, x2, y2] = area.split(',').map((n) => parseFloat(n));
  return {
    position: 'absolute',
    left: `${x1}%`,
    top: `${y1}%`,
    right: `${100 - (x2 ?? 0)}%`,
    bottom: `${100 - (y2 ?? 0)}%`,
  };
}

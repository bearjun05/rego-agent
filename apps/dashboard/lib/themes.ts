/**
 * 테마 카탈로그 — 20개.
 * id가 <html data-theme=…> 속성값과 일치.
 * swatches: 4색 미리보기 (bg / fg / accent / alt) — 디버그 그리드용
 */
export interface ThemeDef {
  id: string;
  name: string;
  vibe: string;
  swatches: [string, string, string, string];
  dark?: boolean;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'brutalist',
    name: '브루털리스트',
    vibe: '종이 + 잉크 (기본)',
    swatches: ['#F2EFE6', '#0A0A0A', '#C5532E', '#D9CFB7'],
  },
  {
    id: 'lego-classic',
    name: '레고 클래식',
    vibe: 'RYBG primary, 화이트',
    swatches: ['#FFFFFF', '#111111', '#DA291C', '#FFD500'],
  },
  {
    id: 'lego-minimal',
    name: '레고 미니멀',
    vibe: '옐로 단색 + 크림',
    swatches: ['#FAF6EC', '#2A2419', '#E8B400', '#F0EBDB'],
  },
  {
    id: 'lego-architectural',
    name: '레고 아키텍처',
    vibe: '회색 + 검정 + 레드, 도면',
    swatches: ['#ECECEC', '#1A1A1A', '#C00000', '#DDDDDD'],
  },
  {
    id: 'lego-pastel',
    name: '레고 파스텔',
    vibe: '크림/민트/연핑크',
    swatches: ['#FDF6F0', '#3D2E2E', '#E89B9B', '#9BD4C4'],
  },
  {
    id: 'lego-noir',
    name: '레고 누아르',
    vibe: '다크 + 옐로 네온',
    swatches: ['#0E0E12', '#F2E9D7', '#F4D300', '#FF6B35'],
    dark: true,
  },
  {
    id: 'lego-cyber',
    name: '레고 사이버',
    vibe: '블랙 + 시안/마젠타 네온',
    swatches: ['#050510', '#E0F7FF', '#FF2E97', '#00E5FF'],
    dark: true,
  },
  {
    id: 'lego-construction',
    name: '레고 컨스트럭션',
    vibe: '옐로/블랙 줄무늬',
    swatches: ['#FFF9E6', '#1A1300', '#FFB800', '#FFEDB3'],
  },
  {
    id: 'lego-paper',
    name: '레고 페이퍼',
    vibe: '종이 질감, 살짝 회전',
    swatches: ['#F4EFE0', '#2E2618', '#B85C2E', '#E8E0CC'],
  },
  {
    id: 'lego-studio',
    name: '레고 스튜디오',
    vibe: '프리미엄 블랙 + 골드',
    swatches: ['#18130C', '#F0E6D2', '#C9A857', '#221C12'],
    dark: true,
  },
  {
    id: 'lego-friends',
    name: '레고 프렌즈',
    vibe: '핑크 + 틸 + 라벤더',
    swatches: ['#FFF0F5', '#6B2D4A', '#FF4D8F', '#4DD0D0'],
  },
  {
    id: 'lego-beach',
    name: '레고 비치',
    vibe: '모래 + 오션 + 코랄',
    swatches: ['#F5E8D0', '#1A3A5C', '#FF6F61', '#1A8FBF'],
  },
  {
    id: 'lego-forest',
    name: '레고 포레스트',
    vibe: '그린, 유기적',
    swatches: ['#E8EFE0', '#1F3A1F', '#5C9C5C', '#C8D6B5'],
  },
  {
    id: 'lego-vintage',
    name: '레고 빈티지',
    vibe: '세피아 + 더스티',
    swatches: ['#E8DDC4', '#3A2A18', '#A8553A', '#5A6A3A'],
  },
  {
    id: 'lego-glass',
    name: '레고 글래스',
    vibe: '프로스트 글래스 + 블러',
    swatches: ['#2D2D5E', '#F0F4FF', '#6EC1FF', '#FFB84D'],
    dark: true,
  },
  {
    id: 'lego-brickwall',
    name: '레고 브릭월',
    vibe: '벽돌 텍스처 배경',
    swatches: ['#C4736B', '#1A1108', '#1A1108', '#FAF2EC'],
  },
  {
    id: 'lego-mono',
    name: '레고 모노',
    vibe: '순 흑백',
    swatches: ['#FFFFFF', '#000000', '#000000', '#F2F2F2'],
  },
  {
    id: 'lego-sunrise',
    name: '레고 선라이즈',
    vibe: '따뜻한 그라데이션',
    swatches: ['#FFE4D0', '#4A1F0F', '#FF6B1F', '#FFAA1F'],
  },
  {
    id: 'lego-studs-prominent',
    name: '레고 스터드 (강조)',
    vibe: '큰 stud + 톤다운',
    swatches: ['#EDE7DC', '#1F1A12', '#C5532E', '#3E5C3E'],
  },
  {
    id: 'lego-plate',
    name: '레고 플레이트',
    vibe: '평평한 베이스플레이트',
    swatches: ['#4A8A4A', '#1A1A1A', '#FFD500', '#FAFAFA'],
  },
];

export const DEFAULT_THEME = 'brutalist';
export const THEME_STORAGE_KEY = 'rego-theme';

export function applyTheme(id: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {}
}

export function getInitialTheme(): string {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    // URL ?theme=X 우선
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('theme');
    if (fromUrl && THEMES.some((t) => t.id === fromUrl)) return fromUrl;
    const fromStorage = localStorage.getItem(THEME_STORAGE_KEY);
    if (fromStorage && THEMES.some((t) => t.id === fromStorage)) return fromStorage;
  } catch {}
  return DEFAULT_THEME;
}

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // var()로 래핑 — 테마가 폰트 패밀리 바꿀 수 있음
        display: ['var(--th-font-display, "JetBrains Mono")', 'ui-monospace', 'monospace'],
        body: [
          'var(--th-font-body, "IBM Plex Sans KR")',
          '"IBM Plex Sans"',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: ['var(--th-font-mono, "JetBrains Mono")', 'ui-monospace', 'monospace'],
      },
      colors: {
        // 모든 컬러 토큰을 CSS 변수로 래핑 → 테마가 즉시 갈아끼움
        paper: 'var(--th-bg, #F2EFE6)',
        ink: 'var(--th-fg, #0A0A0A)',
        warm: 'var(--th-fg-strong, #1A1A1A)',
        rust: 'var(--th-accent, #C5532E)',
        moss: 'var(--th-accent2, #3E5C3E)',
        sand: 'var(--th-bg-alt, #D9CFB7)',
        muted: 'var(--th-muted, #7A736B)',
        line: 'var(--th-border, #1F1F1F)',
        // 4축 컬러 (청사진 시각화용)
        'prim-1': 'var(--th-primary-1, #4A8DD1)',
        'prim-2': 'var(--th-primary-2, #F4D300)',
        'prim-3': 'var(--th-primary-3, #9B6AC8)',
        'prim-4': 'var(--th-primary-4, #6AC89B)',
      },
      boxShadow: {
        brut: 'var(--th-card-shadow, 4px 4px 0 0 #0A0A0A)',
        'brut-sm': 'var(--th-card-shadow-sm, 2px 2px 0 0 #0A0A0A)',
        glow: 'var(--th-glow, none)',
      },
      borderRadius: {
        brick: 'var(--th-card-radius, 0px)',
      },
      borderWidth: {
        brick: 'var(--th-card-border-w, 2px)',
      },
    },
  },
  plugins: [],
};

export default config;

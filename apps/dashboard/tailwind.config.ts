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
        display: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        body: [
          '"IBM Plex Sans KR"',
          '"IBM Plex Sans"',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // 미니멀 + 브루탈리스트 팔레트
        paper: '#F2EFE6',        // 메인 배경
        ink: '#0A0A0A',          // 메인 텍스트
        warm: '#1A1A1A',         // 다크 surface
        rust: '#C5532E',         // 강조 1 (orange-red)
        moss: '#3E5C3E',         // 강조 2 (forest green)
        sand: '#D9CFB7',         // surface light
        muted: '#7A736B',        // muted text
        line: '#1F1F1F',         // border
      },
      boxShadow: {
        brut: '4px 4px 0 0 #0A0A0A',
        'brut-sm': '2px 2px 0 0 #0A0A0A',
      },
    },
  },
  plugins: [],
};

export default config;

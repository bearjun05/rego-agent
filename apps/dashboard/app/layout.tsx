import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export const metadata: Metadata = {
  title: 'REGO-AGENT · 스파르타 AI 에이전트 스터디',
  description: '15명의 비개발자가 본인 AI 비서를 깎는 8주 스터디',
};

// FOUC 방지 — 페이지 그리기 전에 data-theme 속성 적용
const initTheme = `
(function(){
  try {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('theme');
    var stored = localStorage.getItem('rego-theme');
    var t = fromUrl || stored || 'brutalist';
    document.documentElement.dataset.theme = t;
  } catch(e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: initTheme }} />
      </head>
      <body className="min-h-screen font-body bg-paper text-ink">
        <Header />
        <main className="px-6 lg:px-10 pb-24">{children}</main>
        <footer className="px-6 lg:px-10 py-10 mt-20 border-t-2 border-ink text-xs font-mono uppercase text-muted">
          <div className="flex justify-between items-center">
            <span>rego-agent · v0.1.0</span>
            <span>spalta study · 매주 수 12:30</span>
          </div>
        </footer>
        <ThemeSwitcher />
      </body>
    </html>
  );
}

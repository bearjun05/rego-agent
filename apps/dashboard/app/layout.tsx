import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';

export const metadata: Metadata = {
  title: 'REGO-AGENT · 스파르타 AI 에이전트 스터디',
  description: '15명의 비개발자가 본인 AI 비서를 깎는 8주 스터디',
};

// 프로덕션 모드 — 테마 = lego-pastel 고정, 레이아웃 = classic 고정.
// 스위처는 노출하지 않음. ?theme=/?layout= URL 파라미터도 받지 않음.
const initTheme = `
(function(){
  try {
    document.documentElement.dataset.theme = 'lego-pastel';
    document.documentElement.dataset.layout = 'classic';
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
      </body>
    </html>
  );
}

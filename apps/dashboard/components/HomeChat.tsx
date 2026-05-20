'use client';
import { useEffect, useRef, useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SESSION_KEY = 'rego-chat-session';

// 입장 시 코치가 먼저 건네는 능동 안내 (저장 안 함, 항상 표시)
const GREETING = `👋 안녕하세요, REGO 스터디 코치예요.

오늘 **1주차 목표**는 본인 슬랙 멘션을 텔레그램으로 알려주는 AI 비서를 깎는 거예요.

이렇게 시작하면 돼요:
1. \`pnpm setup\` 으로 내 폴더(agents/<내이름>/) 만들기
2. \`agent.config.ts\` 트리거 확인 — \`trigger.slackMention()\`
3. \`handler.ts\` 의 \`onSlackMention\` 에서 텔레그램으로 알림 보내기
4. 텔레그램 봇에 \`/start <내slug>\` 한 번
5. \`git push\` → 30초 뒤 1주차 대시보드에서 확인

막히면 편하게 물어보세요. 예: "내 에이전트 어떻게 만들어?", "오늘 뭐부터 해야 해?"`;

const SUGGESTIONS = [
  '오늘 뭐부터 해야 해?',
  '슬랙 멘션 알림 어떻게 만들어?',
  '내 폴더는 어디서 시작해?',
];

export function HomeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return 'ssr';
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/runtime/chat/history?sessionId=${sessionId}`)
      .then((r) => r.json())
      .then((data: { messages?: Array<{ role: string; content: string }> }) => {
        if (data.messages?.length) {
          setMessages(
            data.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          );
        }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setMessages((m) => [...m, { role: 'user', content }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/runtime/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: content }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.answer ?? `⚠ ${data.error ?? '응답 없음'}` },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 항상 코치 인사로 시작, 그 뒤에 실제 대화 이어붙임
  const view: Message[] = [{ role: 'assistant', content: GREETING }, ...messages];
  const showSuggestions = messages.length === 0;

  return (
    <div className="brut bg-paper flex flex-col h-[68vh] min-h-[460px] max-h-[720px]">
      <div className="border-b-2 border-ink p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🤖</span>
          <div>
            <div className="font-display font-bold text-lg leading-tight">AI 코치</div>
            <div className="font-mono text-[10px] uppercase text-muted">
              오늘 뭐 해야 할지 알려줄게요
            </div>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase text-muted hidden sm:block">
          WEEK 1 · ONBOARDING
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {view.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} fade-up`}
          >
            <div
              className={`max-w-[85%] px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user' ? 'bg-ink text-paper' : 'bg-sand border-2 border-ink'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-sand border-2 border-ink px-4 py-3 text-sm">
              <span className="inline-block animate-pulse">생각 중...</span>
            </div>
          </div>
        )}

        {showSuggestions && (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={loading}
                className="font-mono text-xs px-3 py-1.5 border-2 border-ink bg-paper hover:bg-ink hover:text-paper transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="border-t-2 border-ink p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="오늘 뭐부터 할지 물어보세요..."
          className="flex-1 px-3 py-2 border-2 border-ink bg-paper font-mono text-sm focus:outline-none focus:bg-sand"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()} className="btn btn-dark">
          전송
        </button>
      </form>
    </div>
  );
}

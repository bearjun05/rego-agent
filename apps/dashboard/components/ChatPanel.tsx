'use client';
import { useEffect, useRef, useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SESSION_KEY = 'rego-chat-session';

export function ChatPanel({ onClose }: { onClose: () => void }) {
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
    // load history
    fetch(`/api/runtime/chat/history?sessionId=${sessionId}`)
      .then((r) => r.json())
      .then((data: { messages?: Array<{ role: string; content: string }> }) => {
        if (data.messages) {
          setMessages(data.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
        }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user' as const, content: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/runtime/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: userMsg.content }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      if (data.answer) {
        setMessages((m) => [...m, { role: 'assistant', content: data.answer! }]);
      } else if (data.error) {
        setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${data.error}` }]);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-end sm:justify-center"
      onClick={onClose}
    >
      <div
        className="brut w-full sm:w-[560px] h-[80vh] sm:h-[640px] sm:mr-10 m-0 sm:m-auto bg-paper flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b-2 border-ink p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl leading-none">🐱</span>
            <div>
              <div className="font-display font-bold text-lg">인솔이</div>
              <div className="font-mono text-[10px] uppercase text-muted">PROJECT-AWARE Q&A</div>
            </div>
          </div>
          <button onClick={onClose} className="btn">
            닫기
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-muted text-sm py-12 text-center">
              <div className="font-display text-2xl mb-2">👋</div>
              "지금 누가 잘 하고 있어?",<br />
              "수미 에이전트는 뭘 분류해?",<br />
              "이번 주차 활동 요약해줘"<br />
              <div className="mt-3 text-xs">같은 질문을 해보세요.</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} fade-up`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-ink text-paper'
                    : 'bg-sand border-2 border-ink'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-sand border-2 border-ink px-3 py-2 text-sm">
                <span className="inline-block animate-pulse">생각 중...</span>
              </div>
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
            placeholder="질문을 입력하세요..."
            className="flex-1 px-3 py-2 border-2 border-ink bg-paper font-mono text-sm focus:outline-none focus:bg-sand"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()} className="btn btn-dark">
            전송
          </button>
        </form>
      </div>
    </div>
  );
}

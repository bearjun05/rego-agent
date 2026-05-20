'use client';
import { useEffect, useRef, useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SESSION_KEY = 'rego-chat-session';
const NAME_KEY = 'rego-user-name';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 사람이 타이핑하는 듯한 지연 (메시지 길이에 비례, 상·하한)
const typingDelay = (text: string) => Math.min(500 + text.length * 38, 2100);

// 2문장이 넘는 텍스트를 여러 메시지로 쪼갬. 줄바꿈 블록(목록 등)은 통째로 유지.
function splitChunks(text: string, maxSentences = 2): string[] {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const block of blocks) {
    // 목록/여러 줄 블록은 그대로 하나의 메시지로
    if (/\n/.test(block) || /^\s*\d+[.)]/.test(block) || /^[-•]/.test(block)) {
      chunks.push(block);
      continue;
    }
    const sentences = block.match(/[^.!?。…]+[.!?。…]+|\S[^.!?。…]*$/g) ?? [block];
    for (let i = 0; i < sentences.length; i += maxSentences) {
      chunks.push(
        sentences
          .slice(i, i + maxSentences)
          .join(' ')
          .trim(),
      );
    }
  }
  return chunks.filter(Boolean);
}

const greetingScript = [
  '안녕하세요! 👋',
  '이름이 뭐예요?',
  '이름 알려주면 오늘 뭐 할지 알려줄게요!',
];

const onboardingScript = (name: string) => [
  `반가워요, ${name}님! 🙌`,
  '오늘은 Slack에서 멘션을 받으면 Telegram으로 알림이 오는 에이전트를 만들 거예요.',
  '사실 직접 커스텀할 수 있는 게 꽤 많아요.',
  '어떤 메시지를 받을지, 답장을 자동으로 할지, 버튼으로 처리할지 같은 것들이요.',
  '이런 것도 한번 도전해볼 수 있겠죠? 😎',
  '일단 처음엔 이렇게 시작하면 돼요 👇',
  '1. `pnpm setup` 으로 내 폴더 만들기\n2. `agent.config.ts` 트리거 확인 — `trigger.slackMention()`\n3. `handler.ts` 에서 `telegram.send` 로 알림 보내기\n4. 텔레그램 봇에 `/start <내slug>` 한 번\n5. `git push` → 30초 뒤 1주차 대시보드에서 확인',
  '막히면 편하게 물어봐요. 예: "답장 자동으로 하려면?", "버튼 어떻게 붙여?"',
];

const SUGGESTIONS = ['답장 자동으로 하려면?', '버튼 메시지 어떻게 만들어?', '내 폴더 어디서 시작해?'];

export function HomeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false); // 봇이 메시지 작성 중("…")
  const [busy, setBusy] = useState(true); // 입력 잠금 (스크립트/응답 진행 중)
  const [name, setName] = useState<string | null>(null);
  const [stage, setStage] = useState<'askName' | 'chatting'>('askName');

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
  const startedRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  // 봇 메시지를 사람처럼: "…" 표시 → 지연 → 메시지 추가, 하나씩
  const typeOut = async (chunks: string[]) => {
    for (const chunk of chunks) {
      setTyping(true);
      await sleep(typingDelay(chunk));
      setTyping(false);
      setMessages((m) => [...m, { role: 'assistant', content: chunk }]);
      await sleep(280);
    }
  };

  // 첫 진입: 이름이 있으면 채팅 모드, 없으면 인사 스크립트
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const saved = typeof window !== 'undefined' ? localStorage.getItem(NAME_KEY) : null;

    (async () => {
      if (saved) {
        setName(saved);
        setStage('chatting');
        // 이전 대화 복원
        try {
          const res = await fetch(`/api/runtime/chat/history?sessionId=${sessionId}`);
          const data = (await res.json()) as { messages?: Message[] };
          if (data.messages?.length) setMessages(data.messages);
        } catch {
          /* ignore */
        }
        await typeOut([`다시 왔네요, ${saved}님! 👋`, '오늘 막힌 거 있으면 바로 물어봐요.']);
        setBusy(false);
        return;
      }
      await typeOut(greetingScript);
      setBusy(false); // 이름 입력 대기
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy || typing) return;
    setInput('');

    // 1) 이름 받기 단계
    if (stage === 'askName') {
      const clean = content.replace(/^(저는|제?\s*이름은|나는)\s*/i, '').replace(/(이에요|예요|입니다|이야|야)\s*$/i, '').trim() || content;
      setMessages((m) => [...m, { role: 'user', content }]);
      setName(clean);
      localStorage.setItem(NAME_KEY, clean);
      setStage('chatting');
      setBusy(true);
      await typeOut(onboardingScript(clean));
      setBusy(false);
      return;
    }

    // 2) 자유 대화 (AI 코치)
    setMessages((m) => [...m, { role: 'user', content }]);
    setBusy(true);
    try {
      const res = await fetch('/api/runtime/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: content }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      const answer = data.answer ?? `⚠ ${data.error ?? '응답이 없어요'}`;
      await typeOut(splitChunks(answer));
    } catch (err) {
      await typeOut([`⚠ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  };

  const showSuggestions = stage === 'chatting' && !busy && !typing && messages.filter((m) => m.role === 'user').length === 0;

  return (
    <div className="brut bg-paper flex flex-col h-[68vh] min-h-[460px] max-h-[720px]">
      <div className="border-b-2 border-ink p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🤖</span>
          <div>
            <div className="font-display font-bold text-lg leading-tight">AI 코치</div>
            <div className="font-mono text-[10px] uppercase text-muted">
              {name ? `${name}님과 함께 1주차` : '오늘 뭐 할지 알려줄게요'}
            </div>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase text-muted hidden sm:block">
          WEEK 1 · ONBOARDING
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} fade-up`}>
            <div
              className={`max-w-[85%] px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user' ? 'bg-ink text-paper' : 'bg-sand border-2 border-ink'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {typing && (
          <div className="flex justify-start fade-up">
            <div className="bg-sand border-2 border-ink px-4 py-3 flex items-center gap-1">
              <span className="typing-dot" />
              <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
              <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        )}

        {showSuggestions && (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSubmit(s)}
                className="font-mono text-xs px-3 py-1.5 border-2 border-ink bg-paper hover:bg-ink hover:text-paper transition-colors"
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
          handleSubmit();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            busy || typing
              ? '잠시만요...'
              : stage === 'askName'
                ? '이름을 입력하세요...'
                : '오늘 뭐부터 할지 물어보세요...'
          }
          className="flex-1 px-3 py-2 border-2 border-ink bg-paper font-mono text-sm focus:outline-none focus:bg-sand disabled:opacity-50"
          disabled={busy || typing}
        />
        <button type="submit" disabled={busy || typing || !input.trim()} className="btn btn-dark">
          전송
        </button>
      </form>
    </div>
  );
}

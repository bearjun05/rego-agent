'use client';
import { useEffect, useRef, useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}
interface Person {
  slug: string; // 폴더 slug (agent name) — 예: uj_choe
  displayName: string; // 풀네임 — 예: 최웅준
}

const SESSION_KEY = 'rego-chat-session';
const PROFILE_KEY = 'rego-user-profile'; // { slug, given, full }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const typingDelay = (text: string) => Math.min(500 + text.length * 38, 2100);

// 복성(두 글자 성) — 성씨 제거 시 예외 처리
const DOUBLE_SURNAMES = ['황보', '선우', '남궁', '제갈', '사공', '독고', '서문', '동방'];
function givenName(full: string): string {
  const f = full.replace(/\s/g, '');
  for (const s of DOUBLE_SURNAMES) if (f.startsWith(s) && f.length > 2) return f.slice(2);
  return f.length > 1 ? f.slice(1) : f;
}

// 입력한 이름을 하드코딩된 사용자(roster)와 매칭
function matchPerson(input: string, roster: Person[]): Person | null {
  const q = input.replace(/\s/g, '');
  if (!q) return null;
  return (
    roster.find((r) => r.displayName.replace(/\s/g, '') === q) ??
    roster.find((r) => givenName(r.displayName) === q) ??
    roster.find((r) => r.displayName.replace(/\s/g, '').endsWith(q)) ??
    roster.find((r) => q.includes(r.displayName.replace(/\s/g, ''))) ??
    null
  );
}

// 2문장 초과 텍스트를 여러 메시지로 분할. 줄바꿈 블록(목록 등)은 통째로 유지.
function splitChunks(text: string, maxSentences = 2): string[] {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const block of blocks) {
    if (/\n/.test(block) || /^\s*\d+[.)]/.test(block) || /^[-•]/.test(block)) {
      chunks.push(block);
      continue;
    }
    const sentences = block.match(/[^.!?。…]+[.!?。…]+|\S[^.!?。…]*$/g) ?? [block];
    for (let i = 0; i < sentences.length; i += maxSentences) {
      chunks.push(sentences.slice(i, i + maxSentences).join(' ').trim());
    }
  }
  return chunks.filter(Boolean);
}

// 이름을 받기 전 가벼운 인사만 스크립트로 (즉시 표시). 이후 온보딩·Q&A는 전부 LLM이 생성.
const greetingScript = [
  '안녕하세요! 👋',
  '이름이 뭐예요?',
  '이름 알려주면 오늘 뭐 할지 알려줄게요!',
];

const SUGGESTIONS = ['답장 자동으로 하려면?', '버튼 메시지 어떻게 만들어?', '내 폴더 어디서 시작해?'];

export function HomeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(true);
  const [given, setGiven] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [stage, setStage] = useState<'askName' | 'chatting'>('askName');

  const rosterRef = useRef<Person[]>([]);
  const sessionRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  const typeOut = async (chunks: string[]) => {
    for (const chunk of chunks) {
      setTyping(true);
      await sleep(typingDelay(chunk));
      setTyping(false);
      setMessages((m) => [...m, { role: 'assistant', content: chunk }]);
      await sleep(280);
    }
  };

  // 사용자별 세션으로 이전 로그 복원
  const loadHistory = async (sid: string) => {
    try {
      const res = await fetch(`/api/runtime/chat/history?sessionId=${encodeURIComponent(sid)}`);
      const data = (await res.json()) as { messages?: Message[] };
      if (data.messages?.length) setMessages(data.messages);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      // roster (하드코딩된 사용자 목록) 로드
      try {
        const res = await fetch('/api/runtime/agents');
        const data = (await res.json()) as { agents?: Array<{ name: string; displayName: string | null }> };
        rosterRef.current = (data.agents ?? [])
          .filter((a) => a.displayName && a.name !== '_template')
          .map((a) => ({ slug: a.name, displayName: a.displayName as string }));
      } catch {
        /* ignore — 매칭 없이 진행 */
      }

      // 이전 방문 프로필 있으면 바로 채팅 모드
      const saved = typeof window !== 'undefined' ? localStorage.getItem(PROFILE_KEY) : null;
      if (saved) {
        try {
          const p = JSON.parse(saved) as { slug: string | null; given: string };
          setGiven(p.given);
          setSlug(p.slug);
          setStage('chatting');
          sessionRef.current = p.slug ? `user-${p.slug}` : localStorage.getItem(SESSION_KEY) ?? `anon-${Date.now()}`;
          await loadHistory(sessionRef.current);
          await typeOut([`다시 왔네요, ${p.given}님! 👋`, '오늘 막힌 거 있으면 바로 물어봐요.']);
          setBusy(false);
          return;
        } catch {
          /* fallthrough */
        }
      }

      await typeOut(greetingScript);
      setBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 실제 LLM 코치 호출 — 사용자(agentName=slug) 로그로 저장 + 호칭(userName) 전달
  const askCoach = async (message: string, sid: string, s: string | null, g: string | null) => {
    setBusy(true);
    try {
      const res = await fetch('/api/runtime/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          message,
          ...(s ? { agentName: s } : {}),
          ...(g ? { userName: g } : {}),
        }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      await typeOut(splitChunks(data.answer ?? `⚠ ${data.error ?? '응답이 없어요'}`));
    } catch (err) {
      await typeOut([`⚠ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy || typing) return;
    setInput('');

    // 1) 이름 받기 → roster 매칭 → LLM이 온보딩 생성
    if (stage === 'askName') {
      setMessages((m) => [...m, { role: 'user', content }]);
      const cleaned =
        content
          .replace(/^(저는|제?\s*이름은|나는)\s*/i, '')
          .replace(/(이에요|예요|입니다|이야|야|라고\s*해요?)\s*$/i, '')
          .trim() || content;

      const person = matchPerson(cleaned, rosterRef.current);
      const g = person ? givenName(person.displayName) : givenName(cleaned);
      const s = person?.slug ?? null;
      const sid = s ? `user-${s}` : localStorage.getItem(SESSION_KEY) ?? `anon-${Date.now()}`;

      setGiven(g);
      setSlug(s);
      setStage('chatting');
      sessionRef.current = sid;
      if (!s) localStorage.setItem(SESSION_KEY, sid);
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ slug: s, given: g, full: person?.displayName ?? cleaned }));

      // 입력한 이름을 첫 메시지로 보내면 코치(LLM)가 환영 + 오늘 미션 + /start 안내를 생성
      await askCoach(cleaned, sid, s, g);
      return;
    }

    // 2) 자유 대화
    setMessages((m) => [...m, { role: 'user', content }]);
    await askCoach(content, sessionRef.current, slug, given);
  };

  const showSuggestions =
    stage === 'chatting' && !busy && !typing && messages.filter((m) => m.role === 'user').length === 0;

  return (
    <div className="brut bg-paper flex flex-col h-[68vh] min-h-[460px] max-h-[720px]">
      <div className="border-b-2 border-ink p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🤖</span>
          <div>
            <div className="font-display font-bold text-lg leading-tight">AI 코치</div>
            <div className="font-mono text-[10px] uppercase text-muted">
              {given ? `${given}님과 함께 1주차` : '오늘 뭐 할지 알려줄게요'}
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

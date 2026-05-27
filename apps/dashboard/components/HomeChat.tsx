'use client';
import { useEffect, useRef, useState } from 'react';
import { BingoBoard, type CellDef, type CellStatus } from './BingoBoard';
import { BingoSidePanel } from './BingoSidePanel';
import { CelebrationConfetti } from './CelebrationConfetti';
import { OAuthCard } from './OAuthCard';
import { ReloadButton } from './ReloadButton';
import { MonitorCard } from './MonitorCard';
import { RevealModal } from './RevealModal';
import { ThemePicker, themeCategoryToIds, themeCategoryReason } from './ThemePicker';
import { weekLabel, weekLabelEn } from '@/lib/week';
import { Markdown } from './Markdown';
import { ChatCard, parseSegments } from './ChatCards';

type CardData =
  | { type: 'oauth'; agentSlug: string; done?: boolean }
  | { type: 'bingo'; agentSlug: string }
  | { type: 'mission'; cell: CellDef }
  | { type: 'reload'; agentSlug: string }
  | { type: 'monitor' }
  | { type: 'theme-picker'; themeIds: string[]; reason: string }
  | { type: 'open-bingo-panel' };

interface Message {
  role: 'user' | 'assistant';
  content: string;
  card?: CardData;
}

const SESSION_KEY = 'rego-chat-session';
const PROFILE_KEY = 'rego-user-profile';
const VERSION_KEY = 'rego-chat-version';
const APP_VERSION = 'v4-2026-05-27-bootstrap'; // bootstrap 흐름 전환 — 옛 정규식 캐시 자동 청소

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const typingDelay = (text: string) => Math.min(500 + text.length * 38, 2100);

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

// 이름 받기 전 즉시 인사. 이후 매칭/환영은 전부 서버 LLM (/bootstrap)이 처리.
const greetingScript = [
  '안녕하세요! 저는 인솔이예요 🐱',
  '이름이 뭐예요? (예: "최웅준" 또는 그냥 "웅준")',
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
  const [bingoRefreshKey, setBingoRefreshKey] = useState(0);
  const [activeMissionCell, setActiveMissionCell] = useState<CellDef | null>(null);

  const lastActivityRef = useRef<number>(Date.now());
  const prevCellsRef = useRef<Record<number, 'done' | 'pending'> | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const revealShownRef = useRef(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [celebFire, setCelebFire] = useState(0);

  const sessionRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  /** 막힘 알림 한 번 보냈는지 — 사용자 입력 들어올 때까지 재발송 X */
  const stuckSentRef = useRef(false);

  useEffect(() => {
    // 페이지 전체 스크롤로 마지막 메시지가 보이게 — 채팅 박스 내부 스크롤 X
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
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

  const loadHistory = async (sid: string) => {
    try {
      const res = await fetch(`/api/runtime/chat/history?sessionId=${encodeURIComponent(sid)}`);
      const data = (await res.json()) as { messages?: Message[] };
      if (data.messages?.length) setMessages(data.messages);
    } catch {
      /* ignore */
    }
  };

  /**
   * 서버 LLM에 첫 인사(또는 호칭 변경) 위임 — roster 매칭 + 환영 멘트 LLM이 결정.
   * 정규식 매칭 없음. LLM이 ask_again 호출하면 stage=askName 유지.
   */
  const callBootstrap = async (text: string) => {
    setBusy(true);
    setTyping(true); // 부트스트랩도 네트워크 대기 — 입력 즉시 typing 표시
    try {
      const sid = sessionRef.current || `pending-${Date.now()}`;
      sessionRef.current = sid;
      const res = await fetch('/api/runtime/chat/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, message: text }),
      });
      const data = (await res.json()) as {
        identified?: 'learner' | 'guest' | 'none';
        slug?: string | null;
        callName?: string | null;
        welcomeMessage?: string;
        error?: string;
      };
      if (data.error) {
        await typeOut([`⚠ ${data.error}`]);
        return;
      }

      const ident = data.identified ?? 'none';
      const callName = data.callName ?? null;
      const newSlug = data.slug ?? null;
      const welcome = data.welcomeMessage ?? '';

      if (ident === 'learner' && newSlug) {
        setSlug(newSlug);
        setGiven(callName);
        setStage('chatting');
        sessionRef.current = `user-${newSlug}`;
        try {
          localStorage.setItem(
            PROFILE_KEY,
            JSON.stringify({ slug: newSlug, given: callName, full: callName }),
          );
          localStorage.setItem(SESSION_KEY, `user-${newSlug}`);
        } catch {}
        if (welcome) await typeOut(splitChunks(welcome));
        // 빙고 패널 자동 열기
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: '', card: { type: 'open-bingo-panel' } },
        ]);
        setSidePanelOpen(true);
      } else if (ident === 'guest') {
        setGiven(callName);
        setSlug(null);
        setStage('chatting');
        // 게스트는 PROFILE_KEY 저장 X — 다음 방문 때 다시 묻기 위함
        try { localStorage.setItem(SESSION_KEY, sid); } catch {}
        if (welcome) await typeOut(splitChunks(welcome));
      } else {
        // ask_again — stage=askName 유지, 환영 멘트만
        if (welcome) await typeOut(splitChunks(welcome));
      }
    } catch (err) {
      await typeOut([`⚠ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setTyping(false);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      // 버전 마이그레이션 — 흐름이 바뀌었으면 옛 프로필 청소
      try {
        const savedVer = localStorage.getItem(VERSION_KEY);
        if (savedVer !== APP_VERSION) {
          localStorage.removeItem(PROFILE_KEY);
          localStorage.removeItem(SESSION_KEY);
          localStorage.setItem(VERSION_KEY, APP_VERSION);
        }
      } catch {}

      // 이전 방문 프로필 복원 (학습자만 저장됨, 게스트는 매번 새로)
      const saved = typeof window !== 'undefined' ? localStorage.getItem(PROFILE_KEY) : null;
      if (saved) {
        try {
          const p = JSON.parse(saved) as { slug: string | null; given: string };
          if (p.slug && p.given) {
            setGiven(p.given);
            setSlug(p.slug);
            setStage('chatting');
            sessionRef.current = `user-${p.slug}`;
            await loadHistory(sessionRef.current);
            await typeOut([
              `다시 왔네요, ${p.given}님! 👋`,
              `오늘은 **${weekLabel()}** — 저번 주 이어서 슬랙 멘션을 텔레그램으로 받는 거예요.`,
              '오른쪽에 빙고판 + 실시간 순위 띄워둘게요. 막히는 거 있으면 바로 물어봐요!',
            ]);
            setMessages((m) => [
              ...m,
              { role: 'assistant', content: '', card: { type: 'open-bingo-panel' } },
            ]);
            setSidePanelOpen(true);
            setBusy(false);
            return;
          }
        } catch {
          /* fallthrough */
        }
      }

      await typeOut(greetingScript);
      setBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insolMessage = (content: string, card?: CardData) => {
    setMessages((m) => [...m, { role: 'assistant', content, card }]);
    lastActivityRef.current = Date.now();
  };

  // SSE 구독
  useEffect(() => {
    if (!slug) return;
    const es = new EventSource('/api/runtime-events');
    const handler = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { type: string; agentName?: string; payload?: unknown };
        if (data.agentName && data.agentName !== slug) return;
        let msg: string | null = null;
        if (data.type === 'slack.mention.received') {
          msg = '🔔 슬랙 멘션 들어왔어요! 1분 안에 텔레그램 도착하는지 봐요.';
        } else if (data.type === 'agent.reloaded') {
          const sha = (data.payload as { sha?: string } | undefined)?.sha?.slice(0, 8);
          msg = `⚡ 코드 적용 완료${sha ? ` (${sha})` : ''}! 슬랙에서 멘션 한 번 보내볼까요?`;
        } else if (data.type === 'tool.called') {
          const payload = data.payload as { toolId?: string } | undefined;
          if (payload?.toolId === 'slack.reactions_add') {
            msg = '👀 이모지 자동 반응 호출됐어요! 3번 빙고 통과 ✓';
          } else if (payload?.toolId === 'telegram.edit_message') {
            msg = '✏️ 텔레그램 메시지 수정 호출 — 버튼 동작 잘 되고 있어요!';
          }
        } else if (data.type === 'run.finished') {
          const trigger = (data.payload as { triggerType?: string } | undefined)?.triggerType;
          if (trigger === 'telegram.callback') {
            msg = '🎯 텔레그램 버튼 콜백 처리됨! 4번 빙고 통과 ✓';
          } else if (trigger === 'cron') {
            msg = '⏰ cron 트리거 발화 성공! 8번 빙고 통과 ✓';
          }
        }
        if (msg) {
          insolMessage(msg);
          setBingoRefreshKey((k) => k + 1);
        }
      } catch {}
    };
    for (const t of [
      'slack.mention.received',
      'agent.reloaded',
      'tool.called',
      'run.finished',
    ]) {
      es.addEventListener(t, handler);
    }
    return () => {
      for (const t of [
        'slack.mention.received',
        'agent.reloaded',
        'tool.called',
        'run.finished',
      ]) {
        es.removeEventListener(t, handler);
      }
      es.close();
    };
  }, [slug]);

  // 빙고 상태 변화 감지
  const checkBingoProgress = async () => {
    if (!slug) return;
    try {
      const r = await fetch(`/api/runtime/bingo/status?agent=${encodeURIComponent(slug)}`);
      const data = (await r.json()) as { cells: Record<string, 'done' | 'pending'> };
      const current: Record<number, 'done' | 'pending'> = {};
      for (const [k, v] of Object.entries(data.cells)) current[Number(k)] = v;
      const prev = prevCellsRef.current;
      if (prev) {
        const newlyDone = Object.entries(current)
          .filter(([id, s]) => s === 'done' && prev[Number(id)] !== 'done')
          .map(([id]) => Number(id));
        for (const id of newlyDone) {
          insolMessage(`🎉 ${id}번 빙고 클리어!`);
        }
        const doneCount = Object.values(current).filter((s) => s === 'done').length;
        if (doneCount >= 6 && !revealShownRef.current) {
          revealShownRef.current = true;
          setTimeout(() => setRevealOpen(true), 1000);
        }
        if (newlyDone.length > 0) {
          if (doneCount === 9) {
            insolMessage('🏁 빙고 9개 완주! 진짜 수고하셨어요. 잠깐 쉬어가도 좋겠어요 ☕');
          } else {
            // 사용자에게 다음 결정권을 줌 — 능동성 유발.
            insolMessage(
              `${doneCount}/9. 이어서 빙고 한 칸 더 풀어볼래요, 아니면 본인 에이전트에 새 기능 하나 더 붙여볼래요? 원하는 방향 말해주면 같이 가볼게요.`,
            );
          }
        }
      } else {
        const doneCount = Object.values(current).filter((s) => s === 'done').length;
        if (doneCount >= 6) revealShownRef.current = true;
      }
      prevCellsRef.current = current;
    } catch {}
  };

  useEffect(() => {
    checkBingoProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bingoRefreshKey, slug]);

  // 막힘 감지
  useEffect(() => {
    if (!slug || stage !== 'chatting') return;
    const STUCK_AFTER_MS = 3 * 60 * 1000;
    const interval = setInterval(() => {
      const since = Date.now() - lastActivityRef.current;
      if (since > STUCK_AFTER_MS && !busy && !typing && !stuckSentRef.current) {
        insolMessage('혹시 어디서 막혔어요? 빙고 한 칸 클릭해서 안내문 다시 보거나, 어떤 부분이 헷갈리는지 적어주시면 같이 풀어볼게요 🐱');
        stuckSentRef.current = true; // 사용자 입력 전까지 재발송 X
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [slug, stage, busy, typing]);

  const handleBingoCellClick = async (cell: CellDef, status: CellStatus) => {
    if (status === 'done') {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `🎉 ${cell.id}번 (${cell.title}) 이미 완료했어요!` },
      ]);
      return;
    }
    setMessages((m) => [
      ...m,
      { role: 'assistant', content: '', card: { type: 'mission', cell } },
    ]);
    if (cell.method === 'chat_input') {
      setActiveMissionCell(cell);
    } else if (slug) {
      // 스니펫(복붙용 코드)은 일부러 안 보냄 — 본인이 클로드코드로 직접 깎게 한다.
      // 다음 한 줄(방향성) 만 안내.
      try {
        const res = await fetch(
          `/api/runtime/insol/cell-guide?cell=${cell.id}&agent=${encodeURIComponent(slug)}`,
        );
        const guide = (await res.json()) as { nextStep?: string };
        if (guide.nextStep) insolMessage(guide.nextStep);
      } catch {}
    }
  };

  const verifyCell = async (cell: CellDef | null) => {
    if (!cell || !slug) return;
    setBusy(true);
    try {
      const r = await fetch('/api/runtime/bingo/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: slug, cell: cell.id }),
      });
      const data = (await r.json()) as { passed: boolean; reason: string; hint?: string };
      if (data.passed) {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: `🎉 **${cell.id}번 빙고 완성!** ${cell.title} — 잘하셨어요!\n\n${data.reason}`,
          },
        ]);
        setBingoRefreshKey((k) => k + 1);
        setCelebFire((n) => n + 1);
        setSidePanelOpen(true);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: `🔄 아직이에요: ${data.reason}${data.hint ? `\n\n💡 ${data.hint}` : ''}`,
          },
        ]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠ 검증 실패: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const claimChatCell = async (cell: CellDef, text: string) => {
    if (!slug) return;
    setBusy(true);
    try {
      const r = await fetch('/api/runtime/bingo/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: slug, cell: cell.id, text }),
      });
      const data = (await r.json()) as { passed: boolean; reason: string };
      if (data.passed) {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: `🎉 **${cell.id}번 빙고 완성!** ${cell.title} — 잘하셨어요!`,
          },
        ]);
        setBingoRefreshKey((k) => k + 1);
        setActiveMissionCell(null);
        setCelebFire((n) => n + 1);
        setSidePanelOpen(true);
      } else {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: `🔄 ${data.reason}` },
        ]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠ 저장 실패: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  /** 메인 LLM 코치 — 도구 호출 결과(actions[])도 받아서 카드/이름변경 처리 */
  const askCoach = async (message: string, sid: string, s: string | null, g: string | null) => {
    setBusy(true);
    setTyping(true); // 사용자가 입력하자마자 typing dots 즉시 표시 (fetch 대기 동안 유지)
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
      const data = (await res.json()) as {
        answer?: string;
        actions?: Array<{ type: string; [k: string]: unknown }>;
        error?: string;
      };
      setTyping(false); // typeOut이 청크별로 다시 setTyping 함
      if (data.answer) {
        await typeOut(splitChunks(data.answer));
      } else if (data.error) {
        await typeOut([`⚠ ${data.error}`]);
      }
      for (const a of data.actions ?? []) {
        // update-name: 사이드 이펙트 (카드 아님)
        if (a.type === 'update-name') {
          const newName = String(a.newCallName ?? '').trim();
          const newSlug = a.slug ? String(a.slug).trim() : '';
          if (!newName) continue;
          setGiven(newName);
          if (newSlug) {
            setSlug(newSlug);
            sessionRef.current = `user-${newSlug}`;
            try {
              localStorage.setItem(
                PROFILE_KEY,
                JSON.stringify({ slug: newSlug, given: newName, full: newName }),
              );
            } catch {}
          } else {
            try {
              const cur = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
              if (cur.slug) {
                localStorage.setItem(
                  PROFILE_KEY,
                  JSON.stringify({ ...cur, given: newName }),
                );
              }
            } catch {}
          }
          continue;
        }
        const card = actionToCard(a, s);
        if (card) {
          setMessages((m) => [...m, { role: 'assistant', content: '', card }]);
        }
      }
    } catch (err) {
      await typeOut([`⚠ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setTyping(false);
      setBusy(false);
    }
  };

  const actionToCard = (
    a: { type: string; [k: string]: unknown },
    fallbackSlug: string | null,
  ): CardData | null => {
    const agentSlug = (a.agentSlug as string | undefined) ?? fallbackSlug;
    switch (a.type) {
      case 'monitor':
        return { type: 'monitor' };
      case 'theme-picker': {
        const cat = (a.category as string | undefined) ?? 'general';
        return { type: 'theme-picker', themeIds: themeCategoryToIds(cat), reason: themeCategoryReason(cat) };
      }
      case 'oauth':
        return agentSlug ? { type: 'oauth', agentSlug } : null;
      case 'reload':
        return agentSlug ? { type: 'reload', agentSlug } : null;
      case 'bingo':
        return agentSlug ? { type: 'bingo', agentSlug } : null;
      default:
        return null;
    }
  };

  const handleSubmit = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy || typing) return;
    setInput('');

    // 1) 이름 받기 → 서버 /bootstrap (LLM 매칭 + 환영)
    if (stage === 'askName') {
      setMessages((m) => [...m, { role: 'user', content }]);
      await callBootstrap(content);
      return;
    }

    lastActivityRef.current = Date.now();
    stuckSentRef.current = false; // 사용자 입력 = 막힘 알림 다시 켜기

    // PAT 자동 감지 + 제출
    const patMatch = content.match(/(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+)/);
    if (patMatch && slug) {
      const masked = patMatch[1]!.slice(0, 14) + '…' + patMatch[1]!.slice(-4);
      setMessages((m) => [...m, { role: 'user', content: content.replace(patMatch[1]!, masked) }]);
      try {
        const r = await fetch('/api/runtime/insol/pat-submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: slug, token: patMatch[1] }),
        });
        const data = (await r.json()) as { ok?: boolean; message?: string; error?: string };
        insolMessage(
          data.ok
            ? `✅ GitHub Token 받았어요! (${masked})\n운영자에게 전달했어요. 잠시 후 본인 브랜치(learner/${slug})가 자동 생성될 거예요.`
            : `⚠ ${data.error ?? '제출 실패'}`,
        );
      } catch (e) {
        insolMessage(`⚠ ${(e as Error).message}`);
      }
      return;
    }

    // 활성 미션이 있고 채팅 입력 셀이면 claim
    if (activeMissionCell && activeMissionCell.method === 'chat_input') {
      setMessages((m) => [...m, { role: 'user', content }]);
      await claimChatCell(activeMissionCell, content);
      return;
    }

    // 자유 대화 — 이름 정정 의도는 서버 LLM이 update_call_name 도구로 처리
    setMessages((m) => [...m, { role: 'user', content }]);
    await askCoach(content, sessionRef.current, slug, given);
  };

  const showSuggestions =
    stage === 'chatting' && !busy && !typing && messages.filter((m) => m.role === 'user').length === 0;

  const doneCount = prevCellsRef.current
    ? Object.values(prevCellsRef.current).filter((s) => s === 'done').length
    : 0;

  return (
    <>
      <CelebrationConfetti trigger={celebFire} duration={2400} />
      {revealOpen && slug && (
        <RevealModal agentSlug={slug} onClose={() => setRevealOpen(false)} />
      )}
    <div
      className={`grid gap-4 transition-[grid-template-columns] duration-300 items-start ${
        sidePanelOpen && slug ? 'grid-cols-1 lg:grid-cols-[2fr_1fr]' : 'grid-cols-1'
      }`}
    >
    <div className="brut bg-paper flex flex-col min-h-[calc(100vh-220px)]">
      <div className="border-b-2 border-ink p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🐱</span>
          <div>
            <div className="font-display font-bold text-lg leading-tight">인솔이</div>
            <div className="font-mono text-[10px] uppercase text-muted">
              {given ? (
                <>
                  <button
                    onClick={async () => {
                      const next = window.prompt('호칭을 어떻게 부를까요? (예: 웅준)', given);
                      if (!next || !next.trim()) return;
                      // 서버 /bootstrap에 위임 — LLM이 매칭 + 호칭 결정
                      await callBootstrap(`내 이름은 ${next.trim()}`);
                    }}
                    className="hover:text-rust transition-colors"
                    title="호칭 변경"
                  >
                    {given}님과 함께 {weekLabel()}
                  </button>
                </>
              ) : (
                '오늘 뭐 할지 알려줄게요'
              )}
            </div>
          </div>
        </div>
        {slug && (
          <div className="hidden sm:flex items-center gap-2 mr-2">
            <span className="font-mono text-[10px] uppercase text-muted">조립</span>
            <div className="brick-row">
              {[1,2,3,4,5,6,7,8,9].map((n) => (
                <span
                  key={n}
                  className={`brick-stud ${n <= doneCount ? 'brick-stud-on' : ''}`}
                  title={`${n <= doneCount ? '✓' : '○'} ${n}/9`}
                />
              ))}
            </div>
            <span className="font-mono text-[10px] text-muted">{doneCount}/9</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase text-muted hidden sm:block">
            {weekLabelEn()} · ONBOARDING
          </span>
          <button
            onClick={() => {
              try {
                localStorage.removeItem(PROFILE_KEY);
                localStorage.removeItem(SESSION_KEY);
              } catch {}
              window.location.reload();
            }}
            className="font-mono text-[9px] text-muted hover:text-rust"
            title="세션 리셋 — 이름부터 다시 시작"
          >
            ↺ 초기화
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className="space-y-2 msg-in">
            {m.content &&
              (m.role === 'user' ? (
                <div className="flex justify-end items-end gap-2">
                  <div
                    className="max-w-[80%] px-4 py-3 text-sm leading-relaxed space-y-2 bg-ink text-paper whitespace-pre-wrap"
                    style={{ borderRadius: 'var(--th-card-radius, 0)' }}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <AssistantMessage content={m.content} />
              ))}
            {m.card && (
              <div className="max-w-[92%]">
                {m.card.type === 'oauth' && (
                  <OAuthCard agentSlug={m.card.agentSlug} done={m.card.done} />
                )}
                {m.card.type === 'bingo' && (
                  <BingoBoard
                    agentSlug={m.card.agentSlug}
                    refreshKey={bingoRefreshKey}
                    onCellClick={(cell, status) => handleBingoCellClick(cell, status)}
                  />
                )}
                {m.card.type === 'mission' && (
                  <div className="brut p-3 bg-paper">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                      Mission · {String(m.card.cell.id).padStart(2, '0')}
                    </div>
                    <div className="font-display font-bold text-sm mb-2 leading-tight">
                      {m.card.cell.title}
                    </div>
                    <div className="text-xs leading-relaxed mb-2">
                      <Markdown text={m.card.cell.description} />
                    </div>
                    <div className="font-mono text-[10px] text-muted bg-sand border-2 border-line p-2 mb-2">
                      <Markdown text={m.card.cell.hint} />
                    </div>
                    {m.card.cell.method === 'chat_input' ? (
                      <div className="font-mono text-[10px] text-muted">
                        ↓ 아래 입력창에 답변을 적어주세요.
                      </div>
                    ) : (
                      <button
                        onClick={() => verifyCell(m.card && m.card.type === 'mission' ? m.card.cell : null)}
                        className="btn btn-primary text-xs"
                      >
                        미션 완성하기 →
                      </button>
                    )}
                  </div>
                )}
                {m.card.type === 'reload' && (
                  <ReloadButton
                    agentSlug={m.card.agentSlug}
                    onComplete={(r) => {
                      if (r.ok) {
                        setBingoRefreshKey((k) => k + 1);
                      }
                    }}
                  />
                )}
                {m.card.type === 'monitor' && <MonitorCard compact />}
                {m.card.type === 'theme-picker' && (
                  <ThemePicker themeIds={m.card.themeIds} reason={m.card.reason} />
                )}
                {m.card.type === 'open-bingo-panel' && (
                  <button
                    onClick={() => setSidePanelOpen(true)}
                    className="brut p-3 bg-paper text-left hover:bg-sand transition-colors group w-full"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Panel</div>
                        <div className="font-display font-bold text-sm leading-tight">
                          빙고판 열어보기
                        </div>
                        <div className="font-mono text-[10px] text-muted mt-0.5">
                          오른쪽에 9칸 빙고 + 실시간 16명 순위가 떠요
                        </div>
                      </div>
                      <span className="font-display font-extrabold text-2xl text-rust group-hover:translate-x-1 transition-transform">
                        →
                      </span>
                    </div>
                  </button>
                )}
              </div>
            )}
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
        className="border-t-2 border-ink p-3 flex gap-2 sticky bottom-0 bg-paper z-20"
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
    {sidePanelOpen && slug && (
      <div className="hidden lg:block lg:sticky lg:top-4 self-start">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase text-muted">사이드 패널</span>
          <button
            onClick={() => setSidePanelOpen(false)}
            className="font-mono text-[10px] text-muted hover:text-ink"
            title="패널 접기"
          >
            접기
          </button>
        </div>
        <BingoSidePanel
          agentSlug={slug}
          refreshKey={bingoRefreshKey}
          onCellExplain={handleBingoCellClick}
        />
      </div>
    )}
    </div>
    </>
  );
}

function AssistantMessage({ content }: { content: string }) {
  const segments = parseSegments(content);
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return (
            <div key={i} className="flex justify-start items-end gap-2">
              <span
                aria-hidden
                className="text-lg leading-none shrink-0 select-none"
                style={{ marginBottom: 4 }}
              >
                🐱
              </span>
              <div
                className="max-w-[80%] px-4 py-3 text-sm leading-relaxed space-y-2 bg-sand border-2 border-line"
                style={{ borderRadius: 'var(--th-card-radius, 0)' }}
              >
                <Markdown text={seg.text} />
              </div>
            </div>
          );
        }
        return (
          <div key={i} className="pl-8 max-w-[92%]">
            <ChatCard type={seg.type} data={seg.data} />
          </div>
        );
      })}
    </div>
  );
}

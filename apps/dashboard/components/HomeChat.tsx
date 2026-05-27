'use client';
import { useEffect, useRef, useState } from 'react';
import { BingoBoard, type CellDef, type CellStatus } from './BingoBoard';
import { BingoSidePanel } from './BingoSidePanel';
import { OAuthCard } from './OAuthCard';
import { ReloadButton } from './ReloadButton';
import { MonitorCard } from './MonitorCard';
import { RevealModal } from './RevealModal';
import { ThemePicker, detectThemeIntent, themeCategoryToIds, themeCategoryReason } from './ThemePicker';
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
  | { type: 'open-bingo-panel' }; // 사이드 패널 열기 버튼 카드

interface Message {
  role: 'user' | 'assistant';
  content: string;
  card?: CardData;
}
interface Person {
  slug: string; // 폴더 slug (agent name) — 예: uj_choe
  displayName: string; // 풀네임 — 예: 최웅준
}

const SESSION_KEY = 'rego-chat-session';
const PROFILE_KEY = 'rego-user-profile'; // { slug, given, full }
const VERSION_KEY = 'rego-chat-version';
const APP_VERSION = 'v3-2026-05-27-name-fix'; // 흐름 변경 시 올리기 → 옛 localStorage 자동 청소

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

// "안녕"·"하이"·"ㅎㅇ" 같은 일반 인사 표현 — 이름으로 받아들이지 말 것
const GREETING_WORDS = new Set([
  '안녕', '하이', '하잉', '헬로', '여보세요', '오', '응', '엉', '예', '네',
  'hi', 'hello', 'hey', 'yo', 'ㅎㅇ', 'ㅎㅎ', 'ㅋㅋ', 'ㅠㅠ', 'ㄱㄱ', 'ㅇㅋ',
]);
function looksLikeGreeting(text: string): boolean {
  const clean = text.replace(/[ㅋㅎ\s.,!?~ㅜㅠ]/g, '').toLowerCase();
  if (clean.length === 0) return true;
  if (clean.length === 1) return true; // 한 글자는 이름 아님
  return GREETING_WORDS.has(clean);
}

/**
 * 채팅 중 이름 정정 의도 감지.
 * "내 이름은 웅준" / "사실 웅준이야" / "웅준이라고 불러줘" / "정정 웅준" 등.
 * 매칭된 이름 후보를 반환 (없으면 null).
 */
function detectNameUpdate(content: string): string | null {
  const patterns = [
    /(?:내\s*이름은?|나는?|저는|난|이름\s*은)\s*([가-힣A-Za-z]{2,8})\s*(?:이?야|입니다|에요|예요|이?에요)?/,
    /([가-힣A-Za-z]{2,8})\s*(?:라고\s*)?(?:불러줘|불러주세요)/,
    /(?:사실|아\s*맞다|정정|바꿔|변경)\s*(?:은)?\s*([가-힣A-Za-z]{2,8})/,
    /이름\s*(?:정정|바꿔|변경|수정)\s*([가-힣A-Za-z]{2,8})/,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    const candidate = m?.[1];
    if (candidate && !GREETING_WORDS.has(candidate.toLowerCase())) return candidate;
  }
  return null;
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
  '안녕하세요! 저는 인솔이예요 🐱',
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
  /** 빙고 셀 자동 재조회 트리거 (검증/적용 후 ++) */
  const [bingoRefreshKey, setBingoRefreshKey] = useState(0);
  /** 현재 학습자가 채팅 입력으로 풀어야 할 셀 (활성 시 입력 = claim) */
  const [activeMissionCell, setActiveMissionCell] = useState<CellDef | null>(null);

  /** 마지막 인터랙션 (사용자 입력 / 시스템 자동 메시지) 타임스탬프 — 막힘 감지용 */
  const lastActivityRef = useRef<number>(Date.now());
  /** 직전 빙고 상태 캐시 — 변화 감지로 축하 메시지 띄움 */
  const prevCellsRef = useRef<Record<number, 'done' | 'pending'> | null>(null);
  /** 첫 진입에서 monitor 카드 표시 여부 */
  const monitorShownRef = useRef(false);
  /** 빙고 6+ 리빌 모달 (한 번만) */
  const [revealOpen, setRevealOpen] = useState(false);
  const revealShownRef = useRef(false);
  /** 오른쪽 빙고 사이드 패널 표시 여부 */
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

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
      // 버전 마이그레이션 — 흐름이 바뀌었으면 옛 프로필 청소
      try {
        const savedVer = localStorage.getItem(VERSION_KEY);
        if (savedVer !== APP_VERSION) {
          // 옛 버전 → PROFILE_KEY/SESSION_KEY 청소 (재진입자 새 흐름 강제)
          localStorage.removeItem(PROFILE_KEY);
          localStorage.removeItem(SESSION_KEY);
          localStorage.setItem(VERSION_KEY, APP_VERSION);
        }
      } catch {}

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

      // 이전 방문 프로필 있으면 새 인사 흐름으로 (옛 "다시 왔네요" 제거)
      const saved = typeof window !== 'undefined' ? localStorage.getItem(PROFILE_KEY) : null;
      if (saved) {
        try {
          const p = JSON.parse(saved) as { slug: string | null; given: string };
          setGiven(p.given);
          setSlug(p.slug);
          setStage('chatting');
          sessionRef.current = p.slug ? `user-${p.slug}` : localStorage.getItem(SESSION_KEY) ?? `anon-${Date.now()}`;
          await loadHistory(sessionRef.current);

          if (p.slug) {
            // 매칭된 학습자 — 첫 진입과 동일한 4줄 인사 (일관성)
            await typeOut([
              `다시 왔네요, ${p.given}님! 👋`,
              '오늘은 **2주차** — 저번 주 이어서 슬랙 멘션을 텔레그램으로 받고, 메시지를 예쁘게 가공하는 게 목표예요.',
              '오른쪽에 빙고판 + 실시간 순위 띄워둘게요. 막히는 거 있으면 바로 물어봐요!',
            ]);
            setMessages((m) => [
              ...m,
              { role: 'assistant', content: '', card: { type: 'open-bingo-panel' } },
            ]);
            setSidePanelOpen(true); // 자동 열기
          } else {
            // 매칭 안 된 익명 — 짧은 인사
            await typeOut([`다시 왔네요, ${p.given}님! 👋`, '오늘 막힌 거 있으면 바로 물어봐요.']);
          }
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

  // 인솔이가 능동으로 메시지 추가하는 헬퍼 (활동 시각 갱신)
  const insolMessage = (content: string, card?: CardData) => {
    setMessages((m) => [...m, { role: 'assistant', content, card }]);
    lastActivityRef.current = Date.now();
  };

  // SSE 구독 — 본인 agentName 이벤트 받으면 인솔이가 능동 반응
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
            msg = '👀 이모지 자동 반응 호출됐어요! 셀 3 통과 ✓';
          } else if (payload?.toolId === 'telegram.edit_message') {
            msg = '✏️ 텔레그램 메시지 수정 호출 — 버튼 동작 잘 되고 있어요!';
          }
        } else if (data.type === 'run.finished') {
          const trigger = (data.payload as { triggerType?: string } | undefined)?.triggerType;
          if (trigger === 'telegram.callback') {
            msg = '🎯 텔레그램 버튼 콜백 처리됨! 셀 4 통과 ✓';
          } else if (trigger === 'cron') {
            msg = '⏰ cron 트리거 발화 성공! 셀 8 통과 ✓';
          }
        }
        if (msg) {
          insolMessage(msg);
          setBingoRefreshKey((k) => k + 1); // 빙고판 즉시 재조회
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

  // 빙고 상태 변화 감지 — 새로 done된 셀 있으면 축하 + 다음 셀 추천 + 6+에서 리빌
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
          insolMessage(`🎉 셀 ${id} 클리어!`);
        }
        const doneCount = Object.values(current).filter((s) => s === 'done').length;
        // 6+ 도달 시 리빌 (한 번만)
        if (doneCount >= 6 && !revealShownRef.current) {
          revealShownRef.current = true;
          setTimeout(() => setRevealOpen(true), 1000);
        }
        // 다음 셀 추천
        if (newlyDone.length > 0) {
          const nextPending = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => current[n] !== 'done');
          if (nextPending) {
            if (doneCount === 9) {
              insolMessage('🏁 빙고 9개 완주! 진짜 수고하셨어요. 잠시 쉬다 와요 ☕');
            } else {
              insolMessage(
                `이제 ${doneCount}/9 — 다음은 셀 ${nextPending}을 풀어볼까요? 빙고판에서 클릭하면 안내해드릴게요.`,
              );
            }
          }
        }
      } else {
        // 첫 로드 — 이미 6+면 즉시 리빌 마킹 (재진입은 모달 안 띄움)
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

  // 막힘 감지 — N분 진전 없으면 인솔이가 먼저 도움 제안
  useEffect(() => {
    if (!slug || stage !== 'chatting') return;
    const STUCK_AFTER_MS = 3 * 60 * 1000;
    const interval = setInterval(() => {
      const since = Date.now() - lastActivityRef.current;
      if (since > STUCK_AFTER_MS && !busy && !typing) {
        insolMessage('혹시 어디서 막혔어요? 셀 클릭해서 안내문 다시 보거나, 어떤 부분이 헷갈리는지 적어주시면 도와드릴게요. 🐱');
        lastActivityRef.current = Date.now(); // 한 번 보내면 리셋
      }
    }, 60 * 1000); // 1분 단위 체크
    return () => clearInterval(interval);
  }, [slug, stage, busy, typing]);

  // 셀 클릭 → 미션 카드를 메시지로 띄움. 자동 검증 셀이면 즉시 verify 시도.
  // + 인솔이가 셀별 코드 스니펫 자동 안내 (cell-guide API)
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
      // 자동 코칭 — 학습자 코드 상태에 맞춘 안내 + 코드 스니펫
      try {
        const res = await fetch(
          `/api/runtime/insol/cell-guide?cell=${cell.id}&agent=${encodeURIComponent(slug)}`,
        );
        const guide = (await res.json()) as { nextStep?: string; snippet?: string };
        if (guide.snippet) {
          insolMessage(
            `다음 한 줄: ${guide.nextStep}\n\n복붙용 스니펫:\n\`\`\`ts\n${guide.snippet}\n\`\`\``,
          );
        } else if (guide.nextStep) {
          insolMessage(guide.nextStep);
        }
      } catch {}
    }
  };

  // 개별 셀 검증 (자동 검증 셀에서 "검증하기" 버튼)
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
          { role: 'assistant', content: `✅ ${cell.id}번 (${cell.title}) 통과! ${data.reason}` },
        ]);
        setBingoRefreshKey((k) => k + 1);
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

  // 채팅 입력 셀 클레임 (텍스트 저장)
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
          { role: 'assistant', content: `🎉 ${cell.id}번 (${cell.title}) 저장됐어요!` },
        ]);
        setBingoRefreshKey((k) => k + 1);
        setActiveMissionCell(null);
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

  // 실제 LLM 코치 호출 — actions[]도 받아서 카드 렌더 (tool calling 결과)
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
      const data = (await res.json()) as {
        answer?: string;
        actions?: Array<{ type: string; category?: string; agentSlug?: string }>;
        error?: string;
      };
      if (data.answer) {
        await typeOut(splitChunks(data.answer));
      } else if (data.error) {
        await typeOut([`⚠ ${data.error}`]);
      }
      // LLM이 결정한 액션 → 카드 렌더
      for (const a of data.actions ?? []) {
        const card = actionToCard(a, s);
        if (card) {
          setMessages((m) => [...m, { role: 'assistant', content: '', card }]);
        }
      }
    } catch (err) {
      await typeOut([`⚠ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  };

  // 서버에서 받은 action → 클라이언트 카드 데이터로 매핑
  const actionToCard = (
    a: { type: string; category?: string; agentSlug?: string },
    fallbackSlug: string | null,
  ): CardData | null => {
    const slug = a.agentSlug ?? fallbackSlug;
    switch (a.type) {
      case 'monitor':
        return { type: 'monitor' };
      case 'theme-picker': {
        // 서버에서 category만 받으므로 클라이언트의 사전 매핑 사용
        const ids = themeCategoryToIds(a.category ?? 'general');
        return { type: 'theme-picker', themeIds: ids, reason: themeCategoryReason(a.category ?? 'general') };
      }
      case 'oauth':
        return slug ? { type: 'oauth', agentSlug: slug } : null;
      case 'reload':
        return slug ? { type: 'reload', agentSlug: slug } : null;
      case 'bingo':
        return slug ? { type: 'bingo', agentSlug: slug } : null;
      default:
        return null;
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

      // 일반 인사어 / 너무 짧은 입력은 이름으로 받아들이지 않음
      if (looksLikeGreeting(cleaned)) {
        await typeOut([
          '안녕하세요! 🐱',
          '근데 이름이 뭐예요? (예: "최웅준" 또는 그냥 "웅준")',
        ]);
        return; // 이름 단계 유지
      }

      const person = matchPerson(cleaned, rosterRef.current);
      // roster에 없으면서 + 너무 짧으면 (한글 2자 미만) 한 번 더 확인
      if (!person && cleaned.length < 2) {
        await typeOut([
          `"${cleaned}"…? 이름 맞아요?`,
          '풀네임이나 이름 두 글자 이상으로 알려주시면 도와드릴게요.',
        ]);
        return;
      }
      const g = person ? givenName(person.displayName) : givenName(cleaned);
      const s = person?.slug ?? null;
      const sid = s ? `user-${s}` : localStorage.getItem(SESSION_KEY) ?? `anon-${Date.now()}`;

      setGiven(g);
      setSlug(s);
      setStage('chatting');
      sessionRef.current = sid;
      if (!s) localStorage.setItem(SESSION_KEY, sid);
      // 매칭된 학습자만 PROFILE 저장 (잘못 매칭된 이름이 새로고침마다 부활하는 거 방지)
      if (s) {
        localStorage.setItem(
          PROFILE_KEY,
          JSON.stringify({ slug: s, given: g, full: person!.displayName }),
        );
      }

      if (s) {
        // 매칭된 학습자 — 고정 스크립트로 환영
        await typeOut([
          `안녕하세요 ${g}님! 👋`,
          '오늘은 **2주차**예요. 저번 주에 했던 거 이어서 진행할 건데, 오늘은 실제로 슬랙과 연결해서 멘션이 오면 텔레그램으로 받아볼 거예요.',
          '그 메시지를 좀 더 예쁘게 가공하거나 여러 기능을 붙여서 — 실제로 내가 쓰는데 도움 되는 에이전트로 만들어보는 게 목표!',
          `${g}님이 조금 더 재밌게 해볼 수 있게 **빙고**를 가지고 와봤어요. 순서는 자유! **3빙고**를 먼저 완성해보세요. 🎯`,
        ]);
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: '', card: { type: 'open-bingo-panel' } },
        ]);
      } else {
        // 매칭 안 됨 → 손님 모드: 스터디 소개 + 다른 사람 구경 유도
        // (스터디는 중간 참여 불가. 구경·체험 위주로 안내)
        await typeOut([
          `반가워요 ${g}님! 🐱 학습자 명단에는 없는 이름인데, 놀러 오신 거예요?`,
          '여기는 **인프피솔루션** — 팀스파르타 사내 스터디예요. 매주 수요일 12:30 운동장1에서 식사하며 진행해요.',
          '"에이전트는 레고다"가 컨셉이에요. AI 모델 + 도구 + 규칙을 블록처럼 끼워서 본인 일 도와주는 AI 비서를 8주 동안 만들어가요.',
          '저는 인솔이 — 학습자들 개인 페이스로 따라갈 수 있게 도와주는 교육 에이전트예요.',
          '아쉽게도 스터디는 중간 참여가 안 돼요. 대신 **다른 분들 뭐 하고 있는지** 한번 살펴보실래요? "다른 사람들 뭐해?"라고 물어보시면 바로 보여드릴게요. 🎯',
        ]);
      }
      return;
    }

    lastActivityRef.current = Date.now(); // 사용자 입력 = 활동

    // PAT 자동 감지 + 제출 (사용자 메시지에 토큰 패턴 있으면)
    const patMatch = content.match(/(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+)/);
    if (patMatch && slug) {
      // 토큰 마스킹해서 user 메시지 표시 (히스토리에 평문 안 남기게)
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

    // 1.5) 이름 정정 의도 자동 감지 — "내 이름은 OO" / "OO이야" 같은 표현
    const newNameRaw = detectNameUpdate(content);
    if (newNameRaw && newNameRaw !== given) {
      setMessages((m) => [...m, { role: 'user', content }]);
      const person = matchPerson(newNameRaw, rosterRef.current);
      const newGiven = person ? givenName(person.displayName) : givenName(newNameRaw);
      const newSlug = person?.slug ?? null;
      setGiven(newGiven);
      if (newSlug) {
        setSlug(newSlug);
        const newSid = `user-${newSlug}`;
        sessionRef.current = newSid;
        try {
          localStorage.setItem(
            PROFILE_KEY,
            JSON.stringify({ slug: newSlug, given: newGiven, full: person!.displayName }),
          );
        } catch {}
        await typeOut([
          `아 ${newGiven}님이셨군요! 정정했어요 ✓`,
          '이제 ' + newGiven + '님으로 부를게요.',
        ]);
        setSidePanelOpen(true);
      } else {
        // roster 매칭 안 됨 — 호칭만 바꾸고 localStorage 저장 X
        try {
          const cur = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
          if (cur.slug) {
            // 매칭된 사용자가 호칭만 바꾸는 경우 — 호칭만 업데이트
            localStorage.setItem(
              PROFILE_KEY,
              JSON.stringify({ ...cur, given: newGiven }),
            );
          }
        } catch {}
        await typeOut([`${newGiven}님이라고 부를게요. (학습자 명단엔 없는 이름이라 일부 기능 제한될 수 있어요)`]);
      }
      return;
    }

    // 2) 자유 대화 — 카드 결정은 서버 LLM tool calling이 함
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
      {revealOpen && slug && (
        <RevealModal agentSlug={slug} onClose={() => setRevealOpen(false)} />
      )}
    <div
      className={`grid gap-4 h-[68vh] min-h-[460px] max-h-[720px] transition-[grid-template-columns] duration-300 ${
        sidePanelOpen && slug ? 'grid-cols-1 lg:grid-cols-[2fr_1fr]' : 'grid-cols-1'
      }`}
    >
    <div className="brut bg-paper flex flex-col h-full overflow-hidden">
      <div className="border-b-2 border-ink p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🐱</span>
          <div>
            <div className="font-display font-bold text-lg leading-tight">인솔이</div>
            <div className="font-mono text-[10px] uppercase text-muted">
              {given ? (
                <>
                  <button
                    onClick={() => {
                      const next = window.prompt('호칭을 어떻게 부를까요? (예: 웅준)', given);
                      if (!next || !next.trim()) return;
                      const trimmed = next.trim();
                      const person = matchPerson(trimmed, rosterRef.current);
                      const ng = person ? givenName(person.displayName) : givenName(trimmed);
                      setGiven(ng);
                      if (person) {
                        setSlug(person.slug);
                        sessionRef.current = `user-${person.slug}`;
                        try {
                          localStorage.setItem(
                            PROFILE_KEY,
                            JSON.stringify({ slug: person.slug, given: ng, full: person.displayName }),
                          );
                        } catch {}
                      } else {
                        try {
                          const cur = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
                          if (cur.slug) {
                            localStorage.setItem(
                              PROFILE_KEY,
                              JSON.stringify({ ...cur, given: ng }),
                            );
                          }
                        } catch {}
                      }
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
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
                    <div className="font-display font-bold text-sm mb-1">
                      🎯 {m.card.cell.id}. {m.card.cell.title}
                    </div>
                    <div className="text-xs leading-relaxed mb-2">
                      <Markdown text={m.card.cell.description} />
                    </div>
                    <div className="font-mono text-[10px] text-muted bg-sand border-2 border-line p-2 mb-2">
                      💡 <Markdown text={m.card.cell.hint} />
                    </div>
                    {m.card.cell.method === 'chat_input' ? (
                      <div className="font-mono text-[10px] text-muted">
                        ↓ 아래 입력창에 답변을 적어주세요. (예: "1번 이모지, 2번..." )
                      </div>
                    ) : (
                      <button
                        onClick={() => verifyCell(m.card && m.card.type === 'mission' ? m.card.cell : null)}
                        className="btn btn-dark text-xs"
                      >
                        검증하기 →
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
                        <div className="font-display font-bold text-sm mb-0.5">
                          🧱 빙고판 열어보기
                        </div>
                        <div className="font-mono text-[10px] text-muted">
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
    {/* 오른쪽 사이드 패널 — 빙고판 + 미니 순위판 */}
    {sidePanelOpen && slug && (
      <div className="hidden lg:block h-full overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase text-muted">사이드 패널</span>
          <button
            onClick={() => setSidePanelOpen(false)}
            className="font-mono text-[10px] text-muted hover:text-ink"
            title="패널 접기"
          >
            ✕ 접기
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

/**
 * 인솔이 메시지 렌더러 — [[card:type {json}]] 토큰을 파싱해서
 * 텍스트는 버블, 카드는 별도 컴포넌트로 분리 렌더.
 */
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

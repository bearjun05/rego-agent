import { defineHandler, z } from '@rego/runtime-sdk';
import type { AgentContext, SlackMentionEvent } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const analyzePrompt = await readFile(path.join(here, 'prompts/analyze.md'), 'utf8');

// ── 분류 카테고리 (교육운영실 맥락) ───────────────────────────
const CATEGORY = {
  policy: { emoji: '🔖', label: '정책·문의' },
  incident: { emoji: '🚨', label: '장애·이슈' },
  settlement: { emoji: '💰', label: '정산' },
  request: { emoji: '📝', label: '요청' },
  schedule: { emoji: '📅', label: '일정' },
  info: { emoji: '📰', label: '정보공유' },
} as const;
type Category = keyof typeof CATEGORY;

// ── 우선순위 ─────────────────────────────────────────────────
const URGENCY = {
  now: { emoji: '🔴', label: '지금 확인' },
  today: { emoji: '🟡', label: '오늘 안' },
  later: { emoji: '⚪', label: '나중에' },
} as const;
type Urgency = keyof typeof URGENCY;

// ── LLM 분석 결과 스키마 (generateJson 출력 검증) ─────────────
const AnalysisSchema = z.object({
  category: z.enum(['policy', 'incident', 'settlement', 'request', 'schedule', 'info']),
  confidence: z.number(),
  urgency: z.enum(['now', 'today', 'later']),
  summary: z.string(),
  reason: z.string(),
  wontakWorthy: z.boolean(),
  wontakTitle: z.string(),
});
type Analysis = z.infer<typeof AnalysisSchema>;

// ── 미처리 건 누적 (다이제스트용 state) ──────────────────────
interface PendingItem {
  at: string;
  category: Category;
  urgency: Urgency;
  title: string;
  userName: string;
  channel: string;
  permalink?: string;
}
const PENDING_KEY = 'pending';
const PENDING_CAP = 50; // 최근 50건만 유지

// ── 인라인 버튼 (확인/패스) ──────────────────────────────────
const REPLY_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '✅ 확인', callback_data: 'ack' },
      { text: '⏭ 패스', callback_data: 'pass' },
    ],
  ],
};

export default defineHandler({
  /** 슬랙에서 본인이 태그될 때 */
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 수신', { text: event.text.slice(0, 80) });

    // 0) 👀 자동 반응 — "봤어요" 신호. 분석 전에 즉시 달아 응답 지연 체감 최소화.
    //    실패해도 본 흐름은 막지 않음 (이미 같은 이모지가 달려 있어도 에러 무시).
    try {
      await ctx.tools['slack.reactions_add']!({
        channel: event.channel,
        ts: event.ts,
        name: 'eyes',
      });
    } catch (err) {
      ctx.logger.warn('reactions_add 실패 (무시하고 진행)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // 1) 분석 — 분류 + 우선순위 + 요약 + 원탁 판단을 한 번의 LLM 호출로
    const analysis = await analyze(event, ctx);

    // 2) 텔레그램 알림 전송 (인라인 버튼 — 확인/패스)
    await ctx.tools['telegram.send']!({
      text: buildAlert(event, analysis),
      parseMode: 'Markdown',
      replyMarkup: REPLY_KEYBOARD,
    });

    // 3) 미처리 건 누적 (info 는 다이제스트에서 제외)
    if (analysis && analysis.category !== 'info') {
      await pushPending(ctx, {
        at: new Date().toISOString(),
        category: analysis.category,
        urgency: analysis.urgency,
        title: clean(analysis.wontakWorthy ? analysis.wontakTitle : analysis.summary).slice(0, 80),
        userName: event.userName ?? event.user,
        channel: event.channelName ?? event.channel,
        permalink: event.permalink,
      });
    }

    return analysis ?? { category: 'unknown', note: 'LLM 분석 실패 — 원문만 전달' };
  },

  /** 텔레그램 인라인 버튼 클릭 (확인/패스) */
  async onTelegramCallback(event, ctx) {
    ctx.logger.info('텔레그램 콜백 수신', { data: event.data, messageId: event.messageId });

    const decided = event.data === 'ack'
      ? { mark: '✅ 확인됨', toast: '확인 처리' }
      : event.data === 'pass'
        ? { mark: '⏭ 패스', toast: '패스 처리' }
        : { mark: `↪︎ ${event.data}`, toast: '처리됨' };

    // 1) toast ack 먼저 (텔레그램 spinner 멈춤)
    await ctx.tools['telegram.answer_callback']!({
      callbackQueryId: event.callbackQueryId,
      text: decided.toast,
    });

    // 2) 원문 끝에 결과 줄 추가 + 버튼 제거
    const stamp = new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Seoul',
    });
    const base = event.messageText ?? '_(원문 없음)_';
    const newText = `${base}\n\n━━━━━━━━━━━━\n${decided.mark} · ${stamp}`;

    await ctx.tools['telegram.edit_message']!({
      chatId: event.chatId,       // 안전망: 도구가 본인 chat 강제. 그대로 넘겨도 무시됨.
      messageId: event.messageId,
      text: newText,
      parseMode: 'Markdown',
      replyMarkup: { inline_keyboard: [] }, // 버튼 제거
    });

    return { decided: event.data };
  },

  /** 대시보드 "수동 실행" 버튼 → 미처리 건 다이제스트 */
  async onManual(_event, ctx) {
    return sendDigest(ctx);
  },

  /**
   * 데일리 다이제스트 (cron).
   * ⚠️ 현재 런타임에는 cron 스케줄러가 없어 이 핸들러는 대기 상태.
   *    운영자가 스케줄러를 붙이면 자동 발화. 그 전까지는 onManual 로 동일 동작.
   */
  async onCron(_event, ctx) {
    return sendDigest(ctx);
  },
});

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────

/** LLM 한 번으로 분류·우선순위·요약·원탁 판단. 실패 시 null (알림은 계속 전송). */
async function analyze(
  event: SlackMentionEvent,
  ctx: AgentContext,
): Promise<Analysis | null> {
  const input = [
    analyzePrompt,
    '',
    '---',
    '## 분석할 슬랙 멘션',
    `채널: #${event.channelName ?? event.channel}`,
    `작성자: ${event.userName ?? event.user}`,
    '본문:',
    '"""',
    event.text,
    '"""',
  ].join('\n');

  try {
    const a = await ctx.llm.generateJson(input, AnalysisSchema, { purpose: '멘션 분석' });
    a.confidence = Math.max(0, Math.min(1, a.confidence)); // 안전 클램프
    return a;
  } catch (err) {
    ctx.logger.warn('LLM 분석 실패 — 기본 알림으로 폴백', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** 텔레그램 알림 본문 조립 */
function buildAlert(event: SlackMentionEvent, analysis: Analysis | null): string {
  const cat = CATEGORY[analysis?.category ?? 'info'];
  const urg = URGENCY[analysis?.urgency ?? 'today'];
  const fuzzy = analysis && analysis.confidence < 0.6 ? ' _(애매)_' : '';

  const lines: string[] = [];
  lines.push(`${urg.emoji} *${urg.label}*  ·  ${cat.emoji} ${cat.label}${fuzzy}`);
  lines.push('');
  lines.push(
    `*from* ${event.userName ?? event.user}   ·   *ch* #${event.channelName ?? event.channel}`,
  );
  if (event.threadTs) lines.push('_↳ 스레드 안 멘션_');
  lines.push('');

  // 본문 — LLM 요약 우선, 실패 시 원문 일부
  if (analysis?.summary) {
    lines.push(clean(analysis.summary));
  } else {
    lines.push(event.text.slice(0, 400) + (event.text.length > 400 ? '…' : ''));
  }
  if (analysis?.reason) {
    lines.push('');
    lines.push(`_${clean(analysis.reason)}_`);
  }
  if (event.permalink) {
    lines.push('');
    lines.push(`[🔗 슬랙 원문 보기](${event.permalink})`);
  }

  // 원탁 등록 블록 (방식 B — 자격증명 없이 복사 브릿지)
  if (analysis?.wontakWorthy && analysis.wontakTitle.trim()) {
    lines.push('');
    lines.push('━━━━━━━━━━━━');
    lines.push('📋 *원탁 등록용* — 아래 코드블록 복사 → `/wontak` 뒤에 붙여넣기');
    lines.push('```');
    lines.push(clean(analysis.wontakTitle));
    lines.push('');
    lines.push(`요청자: ${event.userName ?? event.user} (#${event.channelName ?? event.channel})`);
    lines.push(`맥락: ${clean(analysis.summary)}`);
    if (event.permalink) lines.push(`원문: ${event.permalink}`);
    lines.push('```');
  }

  return lines.join('\n');
}

/** 미처리 건을 state 에 누적 (최근 PENDING_CAP 건 유지) */
async function pushPending(ctx: AgentContext, item: PendingItem): Promise<void> {
  const cur = (await ctx.state.get<PendingItem[]>(PENDING_KEY)) ?? [];
  cur.push(item);
  await ctx.state.set(PENDING_KEY, cur.slice(-PENDING_CAP));
}

/** 누적된 미처리 건을 우선순위별로 묶어 다이제스트 전송 후 비움 */
async function sendDigest(ctx: AgentContext): Promise<{ count: number }> {
  const pending = (await ctx.state.get<PendingItem[]>(PENDING_KEY)) ?? [];

  if (pending.length === 0) {
    await ctx.tools['telegram.send']!({
      text: '🌊 *데일리 다이제스트*\n\n미처리 건이 없어요. 깔끔합니다 ✨',
      parseMode: 'Markdown',
    });
    return { count: 0 };
  }

  const lines: string[] = [`🌊 *데일리 다이제스트* — 미처리 ${pending.length}건`, ''];
  for (const u of ['now', 'today', 'later'] as Urgency[]) {
    const items = pending.filter((p) => p.urgency === u);
    if (items.length === 0) continue;
    lines.push(`${URGENCY[u].emoji} *${URGENCY[u].label}* (${items.length})`);
    for (const it of items.slice(0, 15)) {
      const link = it.permalink ? ` [🔗](${it.permalink})` : '';
      lines.push(
        `· ${CATEGORY[it.category].emoji} ${it.title} — ${it.userName} #${it.channel}${link}`,
      );
    }
    lines.push('');
  }
  lines.push('_이 목록은 전송과 함께 비워져요. 새 멘션부터 다시 누적._');

  await ctx.tools['telegram.send']!({ text: lines.join('\n'), parseMode: 'Markdown' });
  await ctx.state.delete(PENDING_KEY);
  return { count: pending.length };
}

/** LLM 출력 문자열에서 마크다운/코드블록을 깨뜨리는 문자 정리 */
function clean(s: string): string {
  return s.replace(/```/g, "'''").replace(/`/g, "'").trim();
}

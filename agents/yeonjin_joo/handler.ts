import { defineHandler, type AgentContext } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');
const summarizePrompt = await readFile(path.join(here, 'prompts/summarize.md'), 'utf8');
const morningBriefPrompt = await readFile(path.join(here, 'prompts/morning-brief.md'), 'utf8');

// 카테고리별 이모지 (텔레그램 표시용)
const CATEGORY_EMOJI: Record<string, string> = {
  question: '❓',
  request: '📝',
  schedule: '📅',
  info: '📰',
};

// 하루치로 쌓아두는 멘션 1건 (아침 브리핑 재료)
interface MentionLog {
  ts: string;
  from: string;
  channel: string;
  category: string;
  summary: string;
}

/** UTC Date → KST(UTC+9) 기준 YYYY-MM-DD */
function kstDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * [빙고 5] 슬랙 ID(U.../C...)를 사람 이름·채널명으로 변환.
 * 도구 호출이 실패해도 흐름이 끊기지 않게 event 값으로 폴백한다.
 */
async function resolveNames(
  event: { user: string; userName?: string; channel: string; channelName?: string },
  ctx: AgentContext,
): Promise<{ userLabel: string; channelLabel: string }> {
  let userLabel = event.userName ?? event.user;
  let channelLabel = event.channelName ?? event.channel;

  try {
    const u = (await ctx.tools['slack.users_info']!({ user: event.user })) as {
      name?: string;
      real_name?: string;
      display_name?: string;
    };
    userLabel = u.display_name || u.real_name || u.name || userLabel;
  } catch (err) {
    ctx.logger.warn('slack.users_info 실패 — event 값으로 폴백', err);
  }

  try {
    const c = (await ctx.tools['slack.conversations_info']!({ channel: event.channel })) as {
      name?: string;
    };
    channelLabel = c.name || channelLabel;
  } catch (err) {
    ctx.logger.warn('slack.conversations_info 실패 — event 값으로 폴백', err);
  }

  return { userLabel, channelLabel };
}

/** 오늘(KST) 멘션 로그에 한 건 추가. 최근 50건만 유지. */
async function appendDailyLog(ctx: AgentContext, entry: MentionLog): Promise<void> {
  const key = `mentions:${kstDateStr(new Date())}`;
  const prev = (await ctx.state.get<MentionLog[]>(key)) ?? [];
  prev.push(entry);
  await ctx.state.set(key, prev.slice(-50));
}

// ─────────────────────────────────────────────────────────
// 분석 명령 (빙고 6·7) — 멘션에 "이모지 분석" / "태그 분석" 같은 말이 있으면 발동
// ─────────────────────────────────────────────────────────
const ANALYZE_VERB = /(분석|베스트|best|top|순위|랭킹|뽑아)/i;

/** 멘션 텍스트에서 분석 의도 감지. 분석 동사 + 주제어가 둘 다 있어야 발동(오발동 방지). */
function detectCommand(text: string): 'emoji' | 'people' | null {
  if (!ANALYZE_VERB.test(text)) return null;
  if (/이모지|emoji|반응|리액션|이모티콘/i.test(text)) return 'emoji';
  if (/태그|멘션|사람|동료|mention|people/i.test(text)) return 'people';
  return null;
}

/** [빙고 6] 내가 반응을 남긴 메시지들 기준 이모지 BEST 5 */
async function analyzeEmojis(ctx: AgentContext): Promise<string> {
  let items: Array<{
    message?: { reactions?: Array<{ name?: string; count?: number }> };
    file?: { reactions?: Array<{ name?: string; count?: number }> };
  }> = [];
  try {
    const res = (await ctx.tools['slack.reactions_list']!({ count: 100, page: 1 })) as {
      items?: typeof items;
    };
    items = res.items ?? [];
  } catch (err) {
    ctx.logger.warn('slack.reactions_list 실패', err);
    return '이모지 활동을 가져오지 못했어요 (권한/데이터 부족일 수 있어요). 직접 5개 적어주셔도 돼요.';
  }

  const tally = new Map<string, number>();
  for (const item of items) {
    const reactions = item.message?.reactions ?? item.file?.reactions ?? [];
    for (const r of reactions) {
      if (r.name) tally.set(r.name, (tally.get(r.name) ?? 0) + (r.count ?? 1));
    }
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length === 0) {
    return '최근 이모지 활동 데이터가 부족해요. 슬랙에서 이모지를 좀 더 쓴 뒤 다시 시도해보세요.';
  }
  return top.map(([name, count], i) => `${i + 1}. :${name}: — ${count}회`).join('\n');
}

/** [빙고 7] 내가 보낸 메시지에서 가장 많이 태그한 사람 BEST 3 */
async function analyzePeople(ctx: AgentContext): Promise<string> {
  let matches: Array<{ text?: string }> = [];
  try {
    const res = (await ctx.tools['slack.search_messages']!({
      query: 'from:me',
      count: 100,
      sort: 'timestamp',
    })) as { matches?: typeof matches };
    matches = res.matches ?? [];
  } catch (err) {
    ctx.logger.warn('slack.search_messages 실패', err);
    return '내 메시지 검색에 실패했어요 (검색 권한/인덱싱 지연일 수 있어요). 직접 3명 적어주셔도 돼요.';
  }

  const tally = new Map<string, number>();
  for (const m of matches) {
    for (const mm of (m.text ?? '').matchAll(/<@([A-Z0-9]+)>/g)) {
      const id = mm[1];
      if (id) tally.set(id, (tally.get(id) ?? 0) + 1);
    }
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length === 0) {
    return '태그 기록을 충분히 못 찾았어요 (검색 인덱싱 지연일 수 있어요). 직접 3명 적어주셔도 돼요.';
  }

  // 상위 3명만 이름 변환 (API 호출 절약)
  const lines: string[] = [];
  for (let i = 0; i < top.length; i++) {
    const entry = top[i];
    if (!entry) continue;
    const [id, count] = entry;
    let name = id;
    try {
      const u = (await ctx.tools['slack.users_info']!({ user: id })) as {
        name?: string;
        real_name?: string;
        display_name?: string;
      };
      name = u.display_name || u.real_name || u.name || id;
    } catch {
      /* 이름 변환 실패 시 ID 그대로 */
    }
    lines.push(`${i + 1}. ${name} — ${count}회 태그`);
  }
  return lines.join('\n');
}

export default defineHandler({
  /**
   * 슬랙에서 본인이 멘션될 때.
   *   - [빙고 3] 받자마자 👀 이모지
   *   - [빙고 5] ID → 이름/채널명 변환
   *   - 분류 + 요약(LLM 병렬)
   *   - [빙고 4] [확인]/[패스] 버튼이 달린 텔레그램 알림
   *   - 아침 브리핑(빙고 8) 재료로 상태에 누적
   */
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // [빙고 3] 받자마자 원문에 👀 — 실패해도 알림 흐름은 계속.
    try {
      await ctx.tools['slack.reactions_add']!({
        channel: event.channel,
        ts: event.ts,
        name: 'eyes',
      });
    } catch (err) {
      ctx.logger.warn('slack.reactions_add 실패 (무시하고 진행)', err);
    }

    // [빙고 6·7] "이모지 분석해줘" / "태그 분석해줘" 같은 명령이면 분석 모드로.
    const command = detectCommand(event.text);
    if (command === 'emoji') {
      const body = await analyzeEmojis(ctx);
      await ctx.tools['telegram.send']!({
        text: `🎨 *이모지 BEST 5*\n\n${body}\n\n_이 결과를 대시보드 채팅창(빙고 6)에 붙여넣으면 클리어돼요._`,
        parseMode: 'Markdown',
      });
      return { command, body };
    }
    if (command === 'people') {
      const body = await analyzePeople(ctx);
      await ctx.tools['telegram.send']!({
        text: `🏷️ *내가 가장 많이 태그한 사람 BEST 3*\n\n${body}\n\n_이 결과를 대시보드 채팅창(빙고 7)에 붙여넣으면 클리어돼요._`,
        parseMode: 'Markdown',
      });
      return { command, body };
    }

    // [빙고 5] 이름·채널명 변환 + 분류 + 요약을 한꺼번에 병렬로.
    const [{ userLabel, channelLabel }, { category, confidence, reason }, summaryResult] =
      await Promise.all([
        resolveNames(event, ctx),
        ctx.llm.classify({
          text: event.text,
          categories: [
            { id: 'question', description: '답변이 필요한 질문' },
            { id: 'request', description: '작업 요청' },
            { id: 'schedule', description: '일정/회의 조율' },
            { id: 'info', description: '정보 공유, 답변 필요 X' },
          ],
          prompt: classifyPrompt,
        }),
        ctx.llm.generate(
          [
            summarizePrompt,
            '',
            `원문(보낸 사람: ${event.userName ?? event.user}, 채널: #${event.channelName ?? event.channel}):`,
            event.text,
          ].join('\n'),
          { purpose: 'summarize-slack-mention', temperature: 0.3, maxTokens: 200 },
        ),
      ]);

    const summary = summaryResult.text.trim();
    const emoji = CATEGORY_EMOJI[category] ?? '📰';

    // 아침 브리핑 재료로 누적 (빙고 8).
    await appendDailyLog(ctx, {
      ts: event.ts,
      from: userLabel,
      channel: channelLabel,
      category,
      summary,
    });

    // 텔레그램 알림 본문 (빙고 5: ID 대신 이름/채널명 표시).
    const lines = [
      `${emoji} *${category.toUpperCase()}*${confidence >= 0.7 ? '' : ' (애매)'}`,
      ``,
      `*from:* ${userLabel}`,
      `*ch:* #${channelLabel}`,
      ``,
      `📌 ${summary}`,
    ];
    if (reason) lines.push(``, `_분류 근거: ${reason}_`);
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    // [빙고 4] [확인]/[패스] 버튼. callback_data는 64바이트 이하 (action:channel:ts).
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ 확인', callback_data: `ack:${event.channel}:${event.ts}` },
          { text: '⏭️ 패스', callback_data: `pass:${event.channel}:${event.ts}` },
        ],
      ],
    };

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
      replyMarkup,
    });

    return { category, confidence, summary };
  },

  /**
   * [빙고 4] 텔레그램 버튼 클릭 처리.
   * [확인]/[패스]를 누르면 ack(스피너 멈춤) 후 원본 메시지 끝에 결과를 덧붙인다.
   */
  async onTelegramCallback(event, ctx) {
    const action = event.data.split(':')[0];
    const label = action === 'ack' ? '✅ 확인함' : '⏭️ 패스함';

    // 버튼 스피너 멈추기 + toast.
    await ctx.tools['telegram.answer_callback']!({
      callbackQueryId: event.callbackQueryId,
      text: label,
    });

    // 원본 메시지 끝에 처리 결과를 덧붙임 (parseMode 없이 plain — entity 깨짐 방지).
    const stamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const newText = `${event.messageText ?? ''}\n\n— ${label} (${stamp})`;
    await ctx.tools['telegram.edit_message']!({
      chatId: event.chatId,
      messageId: event.messageId,
      text: newText,
    });

    return { action, handled: true };
  },

  /**
   * [빙고 8] 매일 아침 9시 — 어제(KST) 받은 멘션을 모아 텔레그램 브리핑.
   * 누적된 게 없으면 가벼운 아침 인사만 보낸다.
   */
  async onCron(event, ctx) {
    const fired = new Date(event.firedAt);
    const yesterday = new Date(fired.getTime() - 24 * 60 * 60 * 1000);
    const key = `mentions:${kstDateStr(yesterday)}`;
    const logs = (await ctx.state.get<MentionLog[]>(key)) ?? [];

    if (logs.length === 0) {
      await ctx.tools['telegram.send']!({
        text: '☀️ 좋은 아침이에요! 어제는 받은 멘션이 없었어요. 오늘도 화이팅! 💪',
      });
      return { sent: true, count: 0 };
    }

    // LLM에게 어제 멘션 목록을 넘겨 아침 브리핑 작성.
    const listText = logs
      .map((m, i) => `${i + 1}. [${m.category}] ${m.from}(#${m.channel}): ${m.summary}`)
      .join('\n');
    const brief = await ctx.llm.generate([morningBriefPrompt, '', '어제 받은 멘션:', listText].join('\n'), {
      purpose: 'morning-brief',
      temperature: 0.4,
      maxTokens: 400,
    });

    await ctx.tools['telegram.send']!({
      text: `☀️ *어제의 슬랙 브리핑* (${kstDateStr(yesterday)})\n\n${brief.text.trim()}`,
      parseMode: 'Markdown',
    });

    return { sent: true, count: logs.length };
  },
});

import { defineHandler, z, type AgentContext } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');
const draftPrompt = await readFile(path.join(here, 'prompts/draft.md'), 'utf8');
const morningBriefPrompt = await readFile(path.join(here, 'prompts/morning-brief.md'), 'utf8');

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

async function appendDailyLog(ctx: AgentContext, entry: MentionLog): Promise<void> {
  const key = `mentions:${kstDateStr(new Date())}`;
  const prev = (await ctx.state.get<MentionLog[]>(key)) ?? [];
  prev.push(entry);
  await ctx.state.set(key, prev.slice(-50));
}

/** [빙고 5] 슬랙 ID(U.../C...)를 사람 이름·채널명으로 변환. 실패해도 event 값으로 폴백. */
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
    userLabel = u.real_name || u.display_name || u.name || userLabel;
    ctx.logger.info('users_info 결과', { id: event.user, picked: userLabel, raw: u });
  } catch (err) {
    ctx.logger.warn('slack.users_info 실패 — event 값으로 폴백', { err: String(err) });
  }

  try {
    const c = (await ctx.tools['slack.conversations_info']!({ channel: event.channel })) as {
      name?: string;
    };
    channelLabel = c.name || channelLabel;
    ctx.logger.info('conversations_info 결과', { id: event.channel, picked: channelLabel, raw: c });
  } catch (err) {
    ctx.logger.warn('slack.conversations_info 실패 — event 값으로 폴백', { err: String(err) });
  }

  return { userLabel, channelLabel };
}

const CATEGORY_META: Record<string, { emoji: string; label: string }> = {
  question: { emoji: '❓', label: '질문' },
  request: { emoji: '📝', label: '요청' },
  schedule: { emoji: '📅', label: '일정' },
  info: { emoji: '📰', label: '참고' },
};

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // 0) 멘션 메시지에 👀 이모지 달기 (수신 확인용)
    try {
      await ctx.tools['slack.add_reaction']!({
        channel: event.channel,
        timestamp: event.ts,
        emoji: 'eyes',
      });
    } catch (err) {
      ctx.logger.warn('add_reaction 실패', { err: String(err) });
    }

    // [빙고 5] 슬랙 ID → 이름·채널명 변환 (분류와 병렬 가능하지만 가독성 위해 순차)
    const { userLabel, channelLabel } = await resolveNames(event, ctx);

    // 1) 분류
    const { category, confidence, reason } = await ctx.llm.classify({
      text: event.text,
      categories: [
        { id: 'question', description: '답변이 필요한 질문' },
        { id: 'request', description: '작업 요청' },
        { id: 'schedule', description: '일정/회의 조율' },
        { id: 'info', description: '정보 공유, 답변 필요 X' },
      ],
      prompt: classifyPrompt,
    });

    // 2) 요약 + 답장 후보 3개
    const { summary, replies } = await ctx.llm.generateJson(
      [
        draftPrompt,
        ``,
        `보낸이: ${userLabel}`,
        `채널: #${channelLabel}`,
        `분류: ${category}`,
        ``,
        `원문:`,
        event.text,
      ].join('\n'),
      z.object({
        summary: z.string(),
        replies: z.array(z.string()).length(3),
      }),
    );

    // 3) 텔레그램 메시지 + 답장 버튼
    const meta = CATEGORY_META[category] ?? { emoji: '📨', label: category };
    const lines = [
      `${meta.emoji} *${meta.label}*${confidence >= 0.7 ? '' : ' (애매)'}`,
      ``,
      `*from:* ${userLabel}`,
      `*ch:* #${channelLabel}`,
      ``,
      `*요약:* ${summary}`,
    ];
    if (reason) lines.push(``, `_${reason}_`);
    lines.push(``, `*답장 후보:*`);
    replies.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    // [빙고 4] [확인]/[패스] 버튼 (telegram.send + replyMarkup.inline_keyboard)
    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '✅ 확인', callback_data: `ack:${event.channel}:${event.ts}` },
            { text: '⏭️ 패스', callback_data: `pass:${event.channel}:${event.ts}` },
          ],
        ],
      },
    });

    // [빙고 8] 아침 브리핑 재료로 누적 (KST 날짜 키)
    await appendDailyLog(ctx, {
      ts: event.ts,
      from: userLabel,
      channel: channelLabel,
      category,
      summary,
    });

    // 답장 후보를 상태에 저장 (추후 슬랙 답장 자동화에 사용 가능)
    await ctx.state.set(`replies:${event.ts ?? Date.now()}`, {
      channel: event.channel,
      threadTs: event.ts,
      replies,
    });

    return { category, confidence, summary };
  },

  /**
   * [빙고 4] 텔레그램 버튼 클릭 처리.
   * ack(spinner 멈춤) 후 원본 메시지 끝에 처리 결과를 덧붙임.
   */
  async onTelegramCallback(event, ctx) {
    const action = event.data.split(':')[0];
    const label = action === 'ack' ? '✅ 확인함' : '⏭️ 패스함';

    await ctx.tools['telegram.answer_callback']!({
      callbackQueryId: event.callbackQueryId,
      text: label,
    });

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
        text: '☀️ 좋은 아침! 어제 받은 멘션이 없었어요. 오늘도 화이팅 💪',
      });
      return { sent: true, count: 0 };
    }

    const listText = logs
      .map((m, i) => `${i + 1}. [${m.category}] ${m.from}(#${m.channel}): ${m.summary}`)
      .join('\n');
    const brief = await ctx.llm.generate(
      [morningBriefPrompt, '', '어제 받은 멘션:', listText].join('\n'),
      { purpose: 'morning-brief', temperature: 0.4, maxTokens: 400 },
    );

    await ctx.tools['telegram.send']!({
      text: `☀️ *어제의 슬랙 브리핑* (${kstDateStr(yesterday)})\n\n${brief.text.trim()}`,
      parseMode: 'Markdown',
    });

    return { sent: true, count: logs.length };
  },
});

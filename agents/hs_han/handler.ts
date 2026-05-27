import { defineHandler, z } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');
const draftPrompt = await readFile(path.join(here, 'prompts/draft.md'), 'utf8');

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
        `보낸이: ${event.userName ?? event.user}`,
        `채널: #${event.channelName ?? event.channel}`,
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
      `*from:* ${event.userName ?? event.user}`,
      `*ch:* #${event.channelName ?? event.channel}`,
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
});

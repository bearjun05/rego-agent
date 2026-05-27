import { defineHandler, z } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const replyPrompt = await readFile(path.join(here, 'prompts/reply-candidates.md'), 'utf8');

const replySchema = z.object({
  summary: z.string(),
  candidates: z
    .array(
      z.object({
        tone: z.string(),
        text: z.string(),
      }),
    )
    .length(2),
});

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    await ctx.tools['slack.reactions_add']!({
      channel: event.channel,
      ts: event.ts,
      name: 'eyes',
    });

    const { summary, candidates } = await ctx.llm.generateJson(
      event.text,
      replySchema,
      {
        system: replyPrompt,
        maxTokens: 600,
        temperature: 0.4,
        purpose: 'slack-mention-reply-candidates',
      },
    );

    const [c1, c2] = candidates;

    const lines = [
      `📣 *슬랙 멘션*`,
      ``,
      `📝 ${summary}`,
      ``,
      `*from:* ${event.userName ?? event.user}`,
      `*ch:* #${event.channelName ?? event.channel}`,
      ``,
      `──────────`,
      `✏️ *답장 후보*`,
      ``,
      `*① ${c1!.tone}*`,
      c1!.text,
      ``,
      `*② ${c2!.tone}*`,
      c2!.text,
    ];
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: `① ${c1!.tone}`, callback_data: `reply:1` },
            { text: `② ${c2!.tone}`, callback_data: `reply:2` },
          ],
          [
            { text: '✅ 확인', callback_data: 'ack' },
            { text: '⏭ 패스', callback_data: 'pass' },
          ],
        ],
      },
    });

    return { summary, candidates };
  },

  async onTelegramCallback(event, ctx) {
    ctx.logger.info('텔레그램 콜백', { data: event.data });

    const statusByData: Record<string, { toast: string; suffix: string }> = {
      ack: { toast: '확인했어요', suffix: '\n\n──────────\n✅ *확인됨*' },
      pass: { toast: '패스했어요', suffix: '\n\n──────────\n⏭ *패스됨*' },
      'reply:1': { toast: '① 답장 선택', suffix: '\n\n──────────\n📤 *① 답장 선택*' },
      'reply:2': { toast: '② 답장 선택', suffix: '\n\n──────────\n📤 *② 답장 선택*' },
    };

    const status = statusByData[event.data];

    await ctx.tools['telegram.answer_callback']!({
      callbackQueryId: event.callbackQueryId,
      text: status?.toast ?? '처리됨',
    });

    if (!status) return;

    await ctx.tools['telegram.edit_message']!({
      chatId: event.chatId,
      messageId: event.messageId,
      text: (event.messageText ?? '') + status.suffix,
      parseMode: 'Markdown',
    });
  },
});

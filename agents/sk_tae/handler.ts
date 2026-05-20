import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const summarizePrompt = await readFile(path.join(here, 'prompts/summarize.md'), 'utf8');

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    const { text: summary } = await ctx.llm.generate(
      `${summarizePrompt}\n\n---\n슬랙 메시지:\n${event.text}`,
    );

    const lines = [
      `📨 *멘션 요약*`,
      ``,
      `*from:* ${event.userName ?? event.user}`,
      `*ch:* #${event.channelName ?? event.channel}`,
      ``,
      summary.trim(),
    ];
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { summary: summary.trim() };
  },
});

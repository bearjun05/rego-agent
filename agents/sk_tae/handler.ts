import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const summarizePrompt = await readFile(path.join(here, 'prompts/summarize.md'), 'utf8');

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // 멘션을 봤다는 신호로 원문에 👀 즉시 달기 (요약 전에)
    try {
      await ctx.tools['slack.reactions_add']!({
        channel: event.channel,
        ts: event.ts,
        name: 'eyes',
      });
    } catch (err) {
      // 이미 달린 이모지 등은 무시 — 알림 흐름을 막지 않도록
      ctx.logger.warn('eyes 반응 추가 실패', { err: String(err) });
    }

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

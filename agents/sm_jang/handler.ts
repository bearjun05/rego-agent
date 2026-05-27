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

    await ctx.tools['telegram.send_with_button']!({
      text: lines.join('\n'),
      buttons: [
        { text: `① ${c1!.tone}`, callbackData: `reply:1` },
        { text: `② ${c2!.tone}`, callbackData: `reply:2` },
      ],
    });

    return { summary, candidates };
  },
});

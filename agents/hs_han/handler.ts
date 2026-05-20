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

    await ctx.tools['telegram.send_with_button']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
      buttons: [
        { text: '1️⃣', callbackData: 'reply:0' },
        { text: '2️⃣', callbackData: 'reply:1' },
        { text: '3️⃣', callbackData: 'reply:2' },
      ],
    });

    // 답장 후보를 상태에 저장 (콜백 처리 시 사용)
    await ctx.state.set(`replies:${event.ts ?? Date.now()}`, {
      channel: event.channel,
      threadTs: event.ts,
      replies,
    });

    return { category, confidence, summary };
  },
});

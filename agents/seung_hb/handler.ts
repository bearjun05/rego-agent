import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const EMOJI: Record<string, string> = {
  question: '❓',
  request: '📝',
  schedule: '📅',
  info: '📰',
};

const FOOTER: Record<string, string> = {
  question: '_읽고 답변해주세요._',
  request: '_작업 요청입니다. 확인해주세요._',
  schedule: '_일정 관련 내용입니다. 확인해주세요._',
  info: '_공유 사항입니다._',
};

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    const classifyPrompt = await readFile(
      path.join(here, 'prompts/classify.md'),
      'utf8',
    ).catch(() => '');

    const [{ category, confidence }, summaryRaw] = await Promise.all([
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
      ctx.llm.generate({
        prompt: `다음 슬랙 메시지를 2~3문장으로 핵심만 요약해줘. 요약문만 출력하고 다른 말은 하지 마.\n\n${event.text}`,
      }),
    ]);

    const summary =
      typeof summaryRaw === 'string'
        ? summaryRaw
        : (summaryRaw?.text ?? event.text.slice(0, 280));

    const emoji = EMOJI[category] ?? '📌';
    const footer = FOOTER[category] ?? '';

    const lines = [
      `${emoji} *${category.toUpperCase()}*${confidence >= 0.7 ? '' : ' (애매)'}`,
      ``,
      `*from:* ${event.userName ?? event.user}`,
      `*ch:* #${event.channelName ?? event.channel}`,
      ``,
      `*요약:* ${summary}`,
      ``,
      footer,
    ];

    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { category, confidence };
  },
});

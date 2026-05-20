import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');
const replyDraftPrompt = await readFile(path.join(here, 'prompts/reply-draft.md'), 'utf8');

/**
 * 본인 에이전트의 실제 동작 코드.
 *
 * 이벤트 종류별 함수:
 *   - onSlackMention: 슬랙에서 본인 이름이 태그될 때
 *   - onSlackMessage: 채널 메시지 (트리거에 명시했을 때)
 *   - onSlackReaction: 이모지 반응 (트리거에 명시했을 때)
 *   - onCron: 스케줄
 *   - onManual: 대시보드에서 수동 실행
 */
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

    // 2) 슬랙 답장 초안 생성
    const draftInput = [
      `카테고리: ${category}`,
      `보낸 사람: ${event.userName ?? event.user}`,
      `채널: #${event.channelName ?? event.channel}`,
      ``,
      `원문:`,
      event.text,
    ].join('\n');
    const draft = await ctx.llm.generate(draftInput, {
      system: replyDraftPrompt,
      purpose: 'generate',
      maxTokens: 300,
    });
    const draftText = draft.text.trim();

    // 3) 텔레그램 알림 (포맷은 본인이 마음껏 바꾸세요)
    const emoji =
      category === 'question'
        ? '❓'
        : category === 'request'
          ? '📝'
          : category === 'schedule'
            ? '📅'
            : '📰';

    const lines = [
      `${emoji} *${category.toUpperCase()}*${confidence >= 0.7 ? '' : ' (애매)'}`,
      ``,
      `*from:* ${event.userName ?? event.user}`,
      `*ch:* #${event.channelName ?? event.channel}`,
      ``,
      event.text.slice(0, 280) + (event.text.length > 280 ? '…' : ''),
    ];
    if (reason) lines.push(``, `_${reason}_`);
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);
    if (draftText) {
      lines.push(``, `✍️ *답장 초안*`, '```', draftText, '```');
    }

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { category, confidence, draft: draftText };
  },
});

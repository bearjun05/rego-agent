import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');
const summarizePrompt = await readFile(path.join(here, 'prompts/summarize.md'), 'utf8');

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

    // 1) 분류 + 요약을 병렬로 (둘 다 LLM 호출이라 동시에 돌리면 빠름)
    const [{ category, confidence, reason }, summaryResult] = await Promise.all([
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

    // 2) 텔레그램 알림 (요약 중심, 원문은 펼침)
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
      `📌 ${summary}`,
    ];
    if (reason) lines.push(``, `_분류 근거: ${reason}_`);
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { category, confidence, summary };
  },
});

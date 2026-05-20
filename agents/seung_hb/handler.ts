import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');

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

    // 1) 분류 + 요약 병렬 실행
    const [{ category, confidence, reason }, summaryRaw] = await Promise.all([
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

    const summary = typeof summaryRaw === 'string' ? summaryRaw : summaryRaw?.text ?? event.text.slice(0, 280);

    // 2) 텔레그램 알림
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
      `*요약:* ${summary}`,
    ];
    const hasQuestion = event.text.includes('?') || event.text.includes('？');
    const hasExclamation = event.text.includes('!') || event.text.includes('！');
    const hasPeriod = event.text.includes('.');

    if (hasQuestion) {
      lines.push(``, `_읽고 답변해주세요._`);
    } else if (hasExclamation || hasPeriod) {
      lines.push(``, `_공유 사항입니다. 읽어주세요._`);
      if (hasExclamation) lines.push(`_중요할지도 모르는 공유 사항입니다!_`);
    } else if (reason) {
      lines.push(``, `_${reason}_`);
    }
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { category, confidence };
  },
});

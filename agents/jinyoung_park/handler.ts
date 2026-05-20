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
    const channelName = event.channelName ?? event.channel;
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80), channel: channelName });

    // 콘텐츠_강의제작 채널이면 → 요약 모드
    if (channelName?.startsWith('콘텐츠_강의제작')) {
      return await handleLectureMention(event, ctx, channelName);
    }

    // 그 외 채널 → 기존 분류 모드
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
      `*ch:* #${channelName}`,
      ``,
      event.text.slice(0, 280) + (event.text.length > 280 ? '…' : ''),
    ];
    if (reason) lines.push(``, `_${reason}_`);
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { category, confidence };
  },
});

async function handleLectureMention(
  event: { text: string; userName?: string; user?: string; channelName?: string; channel?: string; permalink?: string },
  ctx: any,
  channelName: string,
) {
  // "cc @이름" 패턴이면 참조용 → 요약만 (cc / cc. / c.c / CC / CC. 등)
  const isCc = /\bc\.?c\.?\s*<@/i.test(event.text);

  // LLM으로 내용 요약
  const summary = await ctx.llm.generate({
    prompt: `다음은 슬랙 채널 #${channelName}에서 온 멘션입니다. 핵심 내용을 한국어 2~3줄로 간결하게 요약해주세요. 요청사항이 있으면 명확히 구분해주세요.\n\n${event.text}`,
  });

  if (isCc) {
    // CC 멘션 → 요약만 전송
    const lines = [
      `📌 *강의제작 참조 (CC)*`,
      ``,
      `*from:* ${event.userName ?? event.user}`,
      `*ch:* #${channelName}`,
      ``,
      `*요약:*`,
      summary.text,
    ];
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { mode: 'lecture-cc', channel: channelName };
  }

  // 직접 멘션 → 요약 + 답변 초안 3개
  const drafts = await ctx.llm.generate({
    prompt: [
      `다음은 슬랙 채널 #${channelName}에서 나에게 온 멘션입니다.`,
      `이 메시지에 대한 답변 초안을 3개 만들어주세요.`,
      `각 초안은 톤을 다르게 해주세요: 1) 간결·업무적 2) 친절·상세 3) 핵심만 한 줄`,
      `형식: 번호와 답변만, 부가 설명 없이.`,
      ``,
      `--- 원문 ---`,
      event.text,
    ].join('\n'),
  });

  const lines = [
    `📚 *강의제작 멘션*`,
    ``,
    `*from:* ${event.userName ?? event.user}`,
    `*ch:* #${channelName}`,
    ``,
    `*요약:*`,
    summary.text,
    ``,
    `---`,
    `*답변 초안:*`,
    drafts.text,
  ];
  if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

  await ctx.tools['telegram.send']!({
    text: lines.join('\n'),
    parseMode: 'Markdown',
  });

  return { mode: 'lecture-drafts', channel: channelName };
}

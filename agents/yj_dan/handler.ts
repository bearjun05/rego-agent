import { defineHandler } from '@rego/runtime-sdk';

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    const reply = await ctx.llm.generate({
      prompt: `아래 슬랙 멘션에 짧게 수신 확인 답장을 작성해줘.
규칙: 2문장 이내, 반드시 ^^로 끝낼 것, 따뜻하고 자연스러운 한국어.
멘션 내용: ${event.text}`,
    });

    await ctx.tools['slack.reply']!({
      channel: event.channel,
      threadTs: event.ts,
      text: reply,
    });

    const lines = [
      `*from:* ${event.userName ?? event.user}`,
      `*ch:* #${event.channelName ?? event.channel}`,
      ``,
      event.text,
    ];
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });
  },
});

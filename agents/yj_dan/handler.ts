import { defineHandler } from '@rego/runtime-sdk';

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // 빙고 3: 👀 이모지 반응 (수신 확인 즉시 표시)
    await ctx.tools['slack.reactions_add']!({
      channel: event.channel,
      ts: event.ts,
      name: 'eyes',
    });

    // 1. 텔레그램 알림 먼저 (다른 단계 실패 여부와 무관하게 보장)
    // 빙고 5: 슬랙 API로 실제 이름 조회
    const userInfo = await ctx.tools['slack.users_info']!({ user: event.user });
    const channelInfo = await ctx.tools['slack.conversations_info']!({ channel: event.channel });
    const userName = userInfo.user?.real_name ?? userInfo.user?.name ?? event.user;
    const channelName = channelInfo.channel?.name ?? event.channel;

    const lines = [
      `*from:* ${userName}`,
      `*ch:* #${channelName}`,
      ``,
      event.text,
    ];
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    // 2. LLM으로 수신 확인 답장 생성 후 슬랙 답장
    const raw = await ctx.llm.generate({
      prompt: `아래 슬랙 멘션에 짧게 수신 확인 답장을 작성해줘.
규칙: 2문장 이내, 따뜻하고 자연스러운 한국어.
멘션 내용: ${event.text}`,
    });
    const reply = raw.trimEnd().replace(/[\^]+$/, '') + '^^';

    await ctx.tools['slack.reply']!({
      channel: event.channel,
      threadTs: event.ts,
      text: reply,
    });
  },
});

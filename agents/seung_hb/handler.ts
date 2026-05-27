import { defineHandler } from '@rego/runtime-sdk';

export default defineHandler({
  async onSlackMention(event, ctx) {
    await ctx.tools['telegram.send']!({
      text: `슬랙 멘션이 왔어요!\n\nfrom: ${event.userName ?? event.user}\nch: #${event.channelName ?? event.channel}\n\n${event.text}`,
    });

    await ctx.tools['slack.add_reaction']!({
      channel: event.channel,
      timestamp: event.ts,
      emoji: 'eyes',
    }).catch((err: unknown) => {
      ctx.logger.warn('add_reaction 실패', { error: String(err) });
    });
  },
});

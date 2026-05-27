import { defineHandler } from '@rego/runtime-sdk';

export default defineHandler({
  async onSlackMention(event, ctx) {
    await ctx.tools['telegram.send']!({
      text: `슬랙 멘션이 왔어요!\n\nfrom: ${event.userName ?? event.user}\nch: #${event.channelName ?? event.channel}\n\n${event.text}`,
    });
  },
});

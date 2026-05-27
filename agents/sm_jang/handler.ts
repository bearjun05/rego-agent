import { defineHandler, z } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const replyPrompt = await readFile(path.join(here, 'prompts/reply-candidates.md'), 'utf8');

const replySchema = z.object({
  summary: z.string(),
  candidates: z
    .array(
      z.object({
        tone: z.string(),
        text: z.string(),
      }),
    )
    .length(2),
});

async function analyzeEmojiTop5(ctx: any) {
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  const counts = new Map<string, number>();
  const PAGES = 5;
  let scanned = 0;
  let counted = 0;
  let stop = false;

  for (let page = 1; page <= PAGES && !stop; page++) {
    const { items } = await ctx.tools['slack.reactions_list']!({ count: 100, page });
    if (!items.length) break;
    scanned += items.length;

    for (const item of items as Array<{ message?: { ts?: string; reactions?: Array<{ name: string; count: number }> }; file?: { timestamp?: number; reactions?: Array<{ name: string; count: number }> } }>) {
      const ts = Number(item.message?.ts ?? item.file?.timestamp ?? 0);
      if (ts && ts < since) { stop = true; break; }
      const reactions = item.message?.reactions ?? item.file?.reactions ?? [];
      for (const r of reactions) {
        counts.set(r.name, (counts.get(r.name) ?? 0) + r.count);
      }
      counted++;
    }
    if (items.length < 100) break;
  }

  const top5 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  ctx.logger.info('이모지 BEST 5', { scanned, counted, top5 });

  const lines = [
    `🎨 *내 슬랙 이모지 BEST 5* (최근 30일)`,
    ``,
    `_스캔 ${scanned}개 → 30일 내 ${counted}개 집계_`,
    ``,
    ...top5.map(([name, n], i) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} :${name}: \`${n}회\``),
  ];

  await ctx.tools['telegram.send']!({
    text: lines.join('\n'),
    parseMode: 'Markdown',
  });

  return { scanned, counted, top5 };
}

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    await ctx.tools['slack.reactions_add']!({
      channel: event.channel,
      ts: event.ts,
      name: 'eyes',
    });

    if (/이모지|emoji/i.test(event.text)) {
      ctx.logger.info('이모지 분석 키워드 감지 → BEST 5 분석');
      return analyzeEmojiTop5(ctx);
    }

    const { summary, candidates } = await ctx.llm.generateJson(
      event.text,
      replySchema,
      {
        system: replyPrompt,
        maxTokens: 600,
        temperature: 0.4,
        purpose: 'slack-mention-reply-candidates',
      },
    );

    const [c1, c2] = candidates;

    const looksLikeSlackUserId = (s?: string) => !!s && /^U[A-Z0-9]{6,}$/.test(s);
    const looksLikeSlackChannelId = (s?: string) => !!s && /^[CGD][A-Z0-9]{6,}$/.test(s);

    let fromName = event.userName;
    if ((!fromName || looksLikeSlackUserId(fromName)) && event.user) {
      try {
        const u = await ctx.tools['slack.users_info']!({ user: event.user });
        const resolved = u.display_name || u.real_name || u.name;
        ctx.logger.info('users_info 결과', { user: event.user, resolved, raw: u });
        if (resolved) fromName = resolved;
        else fromName = event.user;
      } catch (err) {
        ctx.logger.warn('users_info 실패', { user: event.user, err: String(err) });
        fromName = event.user;
      }
    }

    let chName = event.channelName;
    if ((!chName || looksLikeSlackChannelId(chName)) && event.channel) {
      try {
        const c = await ctx.tools['slack.conversations_info']!({ channel: event.channel });
        ctx.logger.info('conversations_info 결과', { channel: event.channel, name: c.name });
        if (c.name) chName = c.name;
        else chName = event.channel;
      } catch (err) {
        ctx.logger.warn('conversations_info 실패', { channel: event.channel, err: String(err) });
        chName = event.channel;
      }
    }

    const lines = [
      `📣 *슬랙 멘션*`,
      ``,
      `📝 ${summary}`,
      ``,
      `*from:* ${fromName}`,
      `*ch:* #${chName}`,
      ``,
      `──────────`,
      `✏️ *답장 후보*`,
      ``,
      `*① ${c1!.tone}*`,
      c1!.text,
      ``,
      `*② ${c2!.tone}*`,
      c2!.text,
    ];
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: `① ${c1!.tone}`, callback_data: `reply:1` },
            { text: `② ${c2!.tone}`, callback_data: `reply:2` },
          ],
          [
            { text: '✅ 확인', callback_data: 'ack' },
            { text: '⏭ 패스', callback_data: 'pass' },
          ],
        ],
      },
    });

    return { summary, candidates };
  },

  async onTelegramCallback(event, ctx) {
    ctx.logger.info('텔레그램 콜백', { data: event.data });

    const statusByData: Record<string, { toast: string; suffix: string }> = {
      ack: { toast: '확인했어요', suffix: '\n\n──────────\n✅ *확인됨*' },
      pass: { toast: '패스했어요', suffix: '\n\n──────────\n⏭ *패스됨*' },
      'reply:1': { toast: '① 답장 선택', suffix: '\n\n──────────\n📤 *① 답장 선택*' },
      'reply:2': { toast: '② 답장 선택', suffix: '\n\n──────────\n📤 *② 답장 선택*' },
    };

    const status = statusByData[event.data];

    await ctx.tools['telegram.answer_callback']!({
      callbackQueryId: event.callbackQueryId,
      text: status?.toast ?? '처리됨',
    });

    if (!status) return;

    await ctx.tools['telegram.edit_message']!({
      chatId: event.chatId,
      messageId: event.messageId,
      text: (event.messageText ?? '') + status.suffix,
      parseMode: 'Markdown',
    });
  },

  async onManual(_event, ctx) {
    return analyzeEmojiTop5(ctx);
  },

  async onCron(event, ctx) {
    ctx.logger.info('cron 발화', { schedule: event.schedule });
    await ctx.tools['telegram.send']!({
      text: `☀️ *좋은 아침이에요, 장수미님!*\n\n오늘도 화이팅 💪\n_(매일 09:00 KST 자동 발화)_`,
      parseMode: 'Markdown',
    });
    return { schedule: event.schedule };
  },
});

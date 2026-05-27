import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const summarizePrompt = await readFile(path.join(here, 'prompts/summarize.md'), 'utf8');

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // 멘션을 봤다는 신호로 원문에 👀 즉시 달기 (요약 전에)
    try {
      await ctx.tools['slack.reactions_add']!({
        channel: event.channel,
        ts: event.ts,
        name: 'eyes',
      });
    } catch (err) {
      // 이미 달린 이모지 등은 무시 — 알림 흐름을 막지 않도록
      ctx.logger.warn('eyes 반응 추가 실패', { err: String(err) });
    }

    const { text: summary } = await ctx.llm.generate(
      `${summarizePrompt}\n\n---\n슬랙 메시지:\n${event.text}`,
    );

    // 텔레그램 보내기 전에 슬랙 API로 사람 이름·채널명 보강.
    // 조회 실패(권한/없는 ID 등)해도 이벤트가 준 값으로 폴백 → 알림은 계속 나간다.
    let fromName = event.userName ?? event.user;
    let channelName = event.channelName ?? event.channel;

    try {
      const u = await ctx.tools['slack.users_info']!({ user: event.user });
      fromName = u.real_name ?? u.display_name ?? u.name ?? fromName;
    } catch (err) {
      ctx.logger.warn('users_info 조회 실패 — 이벤트 값 사용', { err: String(err) });
    }

    try {
      const c = await ctx.tools['slack.conversations_info']!({ channel: event.channel });
      channelName = c.name ?? channelName;
    } catch (err) {
      ctx.logger.warn('conversations_info 조회 실패 — 이벤트 값 사용', { err: String(err) });
    }

    const lines = [
      `📨 *멘션 요약*`,
      ``,
      `*from:* ${fromName}`,
      `*ch:* #${channelName}`,
      ``,
      summary.trim(),
    ];
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '✅ 확인', callback_data: 'ack' },
            { text: '⏭️ 패스', callback_data: 'pass' },
          ],
        ],
      },
    });

    return { summary: summary.trim() };
  },

  async onTelegramCallback(event, ctx) {
    ctx.logger.info('텔레그램 버튼 클릭', {
      data: event.data,
      by: event.userName ?? event.userId,
    });

    const who = event.userName ?? event.userId;
    const at = new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul',
    });

    // 어떤 버튼을 눌렀는지에 따라 상태 헤더 결정
    const status =
      event.data === 'ack'
        ? `✅ 확인 완료 · ${who} · ${at}`
        : event.data === 'pass'
          ? `⏭️ 패스함 · ${who} · ${at}`
          : `❓ 알 수 없는 동작 (${event.data})`;

    // 버튼 클릭 ack — 안 하면 버튼에 로딩 스피너가 계속 돈다
    await ctx.tools['telegram.answer_callback']!({
      callbackQueryId: event.callbackQueryId,
      text: event.data === 'ack' ? '확인 처리했어요' : '패스했어요',
    });

    // 원본 메시지를 "상태 헤더 + 원문" 으로 수정.
    // replyMarkup 을 안 넘기면 텔레그램이 인라인 버튼을 제거 → 한 번만 누르게 됨.
    const body = event.messageText ?? '';
    await ctx.tools['telegram.edit_message']!({
      chatId: event.chatId,
      messageId: event.messageId,
      text: body ? `${status}\n\n${body}` : status,
    });

    return { action: event.data };
  },
});

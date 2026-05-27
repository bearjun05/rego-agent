import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const summarizePrompt = await readFile(path.join(here, 'prompts/summarize.md'), 'utf8');

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // 본문에 박힌 슬랙 토큰(<@U123>, <#C123|name>, <!here>)을 사람이 읽을 이름으로 변환.
    // 요약 "전"에 변환해야 LLM 요약문에도 ID 대신 이름이 들어간다.
    const resolveRefs = async (raw: string): Promise<string> => {
      // 1) 유저 멘션: <@U123> 또는 <@U123|handle> → @이름 (중복 ID는 한 번만 조회)
      const ids = new Set<string>();
      for (const m of raw.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g)) ids.add(m[1]);
      const nameById = new Map<string, string>();
      for (const id of ids) {
        try {
          const u = await ctx.tools['slack.users_info']!({ user: id });
          nameById.set(id, u.real_name ?? u.display_name ?? u.name ?? id);
        } catch (err) {
          ctx.logger.warn('본문 멘션 users_info 실패 — 토큰 값 폴백', { id, err: String(err) });
        }
      }
      return raw
        .replace(
          /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g,
          (_f, id, handle) => `@${nameById.get(id) ?? handle ?? id}`,
        )
        // 2) 채널 멘션: <#C123|name> → #name (이름이 토큰에 박혀 있으면 그대로 사용)
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_f, name) => `#${name}`)
        .replace(/<#([A-Z0-9]+)>/g, (_f, id) => `#${id}`)
        // 3) 특수 멘션: <!here>, <!channel>, <!subteam^...|@팀> 등
        .replace(/<!(\w+)(?:\^[A-Z0-9]+)?(?:\|([^>]+))?>/g, (_f, kw, label) => label ?? `@${kw}`);
    };

    const resolvedText = await resolveRefs(event.text);

    const { text: summary } = await ctx.llm.generate(
      `${summarizePrompt}\n\n---\n슬랙 메시지:\n${resolvedText}`,
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

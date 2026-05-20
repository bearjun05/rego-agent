import { defineTool, z } from '@rego/runtime-sdk';

export class TelegramClient {
  constructor(private token: string) {}

  async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.description}`);
    }
    return data.result as T;
  }

  sendMessage(opts: {
    chat_id: string | number;
    text: string;
    parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    reply_markup?: unknown;
    disable_web_page_preview?: boolean;
  }) {
    return this.call<{ message_id: number }>('sendMessage', opts);
  }

  setMyCommands(commands: Array<{ command: string; description: string }>) {
    return this.call('setMyCommands', { commands });
  }

  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>('getMe', {});
  }
}

// ─────────────────────────────────────────────────────────
// 공통 도구
// ─────────────────────────────────────────────────────────
export const telegramSend = defineTool({
  id: 'telegram.send',
  name: '텔레그램 보내기',
  description: '본인 텔레그램으로 메시지를 보냅니다 (chat_id는 자동)',
  category: 'messaging',
  icon: '📱',
  color: '#0088CC',
  inputs: z.object({
    text: z.string(),
    parseMode: z.enum(['Markdown', 'HTML']).optional(),
    chatId: z.string().optional(),
  }),
  outputs: z.object({
    ok: z.boolean(),
    messageId: z.number().optional(),
  }),
  costTier: 'free',
  latencyTier: 'fast',
  sideEffects: { writes: ['telegram'] },
  secrets: ['TELEGRAM_BOT_TOKEN'],
  async run({ text, parseMode, chatId }, ctx) {
    // chatId가 없으면 런타임이 그 에이전트의 chat_id를 사용 (런타임에서 주입)
    const finalChatId = chatId ?? (ctx as unknown as { agentChatId?: string }).agentChatId;
    if (!finalChatId) {
      throw new Error('chatId가 필요해요. setup 마법사로 텔레그램 연결을 먼저 끝내세요.');
    }
    const tg = new TelegramClient(ctx.secret('TELEGRAM_BOT_TOKEN'));
    try {
      const r = await tg.sendMessage({
        chat_id: finalChatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      });
      ctx.logger.info('telegram.send 완료', { messageId: r.message_id });
      return { ok: true, messageId: r.message_id };
    } catch (err) {
      // Markdown/HTML 파싱 실패 시 plain text로 재시도 (알림 누락 방지)
      const msg = err instanceof Error ? err.message : String(err);
      if (parseMode && /parse entities|can't parse/i.test(msg)) {
        ctx.logger.warn('telegram 파싱 실패 → plain text 재시도', { msg });
        const r = await tg.sendMessage({
          chat_id: finalChatId,
          text,
          disable_web_page_preview: true,
        });
        return { ok: true, messageId: r.message_id };
      }
      throw err;
    }
  },
});

export const telegramSendWithButton = defineTool({
  id: 'telegram.send_with_button',
  name: '텔레그램 버튼 메시지',
  description: '인라인 버튼이 있는 텔레그램 메시지를 보냅니다',
  category: 'messaging',
  icon: '📱',
  color: '#0088CC',
  inputs: z.object({
    text: z.string(),
    buttons: z.array(
      z.object({
        text: z.string(),
        callbackData: z.string(),
      }),
    ),
    chatId: z.string().optional(),
  }),
  outputs: z.object({ ok: z.boolean(), messageId: z.number().optional() }),
  costTier: 'free',
  secrets: ['TELEGRAM_BOT_TOKEN'],
  async run({ text, buttons, chatId }, ctx) {
    const finalChatId = chatId ?? (ctx as unknown as { agentChatId?: string }).agentChatId;
    if (!finalChatId) throw new Error('chatId가 필요해요.');
    const tg = new TelegramClient(ctx.secret('TELEGRAM_BOT_TOKEN'));
    const r = await tg.sendMessage({
      chat_id: finalChatId,
      text,
      reply_markup: {
        inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.callbackData }))],
      },
    });
    return { ok: true, messageId: r.message_id };
  },
});

export const allTelegramTools = [telegramSend, telegramSendWithButton];

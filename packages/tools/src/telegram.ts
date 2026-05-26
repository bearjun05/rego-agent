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

  /** Phase 3: 버튼 클릭 ack (텔레그램 클라이언트 spinner 멈춤) */
  answerCallbackQuery(opts: {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
  }) {
    return this.call('answerCallbackQuery', opts);
  }

  /** Phase 3: 콜백 후 원본 메시지 텍스트 수정 (예: 버튼 누른 결과 표시) */
  editMessageText(opts: {
    chat_id: string | number;
    message_id: number;
    text: string;
    parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    reply_markup?: unknown;
  }) {
    return this.call('editMessageText', opts);
  }
}

// ─────────────────────────────────────────────────────────
// 공통 도구
// ─────────────────────────────────────────────────────────
export const telegramSend = defineTool({
  id: 'telegram.send',
  name: '텔레그램 보내기',
  description: '본인 텔레그램으로 메시지를 보냅니다 (chat_id는 자동, 버튼 옵션 가능)',
  category: 'messaging',
  icon: '📱',
  color: '#0088CC',
  inputs: z.object({
    text: z.string(),
    parseMode: z.enum(['Markdown', 'HTML']).optional(),
    chatId: z.string().optional(),
    /** Phase 3: inline_keyboard 등 reply_markup 직접 전달 */
    replyMarkup: z.unknown().optional(),
  }),
  outputs: z.object({
    ok: z.boolean(),
    messageId: z.number().optional(),
  }),
  costTier: 'free',
  latencyTier: 'fast',
  sideEffects: { writes: ['telegram'] },
  secrets: ['TELEGRAM_BOT_TOKEN'],
  async run({ text, parseMode, chatId, replyMarkup }, ctx) {
    const finalChatId = chatId ?? ctx.agentChatId;
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
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        return { ok: true, messageId: r.message_id };
      }
      throw err;
    }
  },
});

// ─────────────────────────────────────────────────────────
// Phase 3: 콜백 처리 도구
// ─────────────────────────────────────────────────────────
export const telegramAnswerCallback = defineTool({
  id: 'telegram.answer_callback',
  name: '텔레그램 콜백 ack',
  description: '버튼 클릭 콜백에 ack (텔레그램 spinner 멈춤). 선택적으로 toast 알림 표시',
  category: 'messaging',
  icon: '✅',
  color: '#0088CC',
  inputs: z.object({
    callbackQueryId: z.string(),
    text: z.string().optional().describe('짧은 toast 알림'),
    showAlert: z.boolean().optional().describe('true면 dialog로 표시'),
  }),
  outputs: z.object({ ok: z.boolean() }),
  costTier: 'free',
  secrets: ['TELEGRAM_BOT_TOKEN'],
  async run({ callbackQueryId, text, showAlert }, ctx) {
    const tg = new TelegramClient(ctx.secret('TELEGRAM_BOT_TOKEN'));
    await tg.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
      ...(showAlert ? { show_alert: showAlert } : {}),
    });
    return { ok: true };
  },
});

export const telegramEditMessage = defineTool({
  id: 'telegram.edit_message',
  name: '텔레그램 메시지 수정',
  description: '이미 보낸 메시지의 텍스트를 수정 (콜백 후 결과 표시용)',
  category: 'messaging',
  icon: '✏️',
  color: '#0088CC',
  inputs: z.object({
    chatId: z.string(),
    messageId: z.number().int().positive(),
    text: z.string(),
    parseMode: z.enum(['Markdown', 'HTML']).optional(),
    replyMarkup: z.unknown().optional(),
  }),
  outputs: z.object({ ok: z.boolean() }),
  costTier: 'free',
  secrets: ['TELEGRAM_BOT_TOKEN'],
  async run({ chatId, messageId, text, parseMode, replyMarkup }, ctx) {
    const tg = new TelegramClient(ctx.secret('TELEGRAM_BOT_TOKEN'));
    await tg.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return { ok: true };
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

export const allTelegramTools = [
  telegramSend,
  telegramSendWithButton,
  telegramAnswerCallback,
  telegramEditMessage,
];

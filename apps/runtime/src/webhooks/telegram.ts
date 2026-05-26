import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { TelegramClient } from '@rego/tools/telegram';
import { getDb, telegramPending, agents } from '@rego/db';
import type { TelegramCallbackEvent } from '@rego/runtime-sdk';
import { env } from '../env.js';
import { createLogger } from '../logger.js';
import { getEventBus } from '../event-bus.js';
import { runAgentByName } from '../agent-runner.js';

const log = createLogger('webhook:telegram');

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string; title?: string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id: number; first_name?: string; username?: string };
    data?: string;
    message?: {
      message_id: number;
      chat: { id: number };
      text?: string;
    };
  };
}

/**
 * Phase 3: 콜백 쿼리 → TelegramCallbackEvent (순수 함수, 테스트 가능).
 *
 * 필수: callback_query.id + message.chat.id + message_id
 * 누락 시 null (드롭).
 */
export function parseTelegramCallback(update: TelegramUpdate): TelegramCallbackEvent | null {
  const cq = update.callback_query;
  if (!cq || !cq.id) return null;
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  if (chatId === undefined || messageId === undefined) return null;
  return {
    type: 'telegram.callback',
    callbackQueryId: cq.id,
    data: cq.data ?? '',
    chatId: String(chatId),
    messageId,
    userId: String(cq.from?.id ?? ''),
    userName: cq.from?.first_name,
    messageText: cq.message?.text,
  };
}

export function createTelegramRouter() {
  const router = new Hono();

  // Webhook endpoint (Telegram이 setWebhook으로 등록)
  router.post('/', async (c) => {
    const cfg = env();
    if (!cfg.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: 'telegram not configured' }, 503);
    }

    let update: TelegramUpdate;
    try {
      update = await c.req.json<TelegramUpdate>();
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }

    // Phase 3: 버튼 콜백 분기
    if (update.callback_query) {
      const ev = parseTelegramCallback(update);
      if (!ev) {
        log.warn('callback_query 파싱 실패 — 필수 필드 누락');
        return c.json({ ok: true });
      }
      // chat_id로 agent 찾기 (1:1 매핑)
      const db = getDb();
      const [agent] = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.telegramChatId, ev.chatId));
      if (!agent) {
        log.info(`callback received but no agent for chat ${ev.chatId} — drop`);
        // ack는 그래도 보내야 텔레그램이 buttom spinner 멈춤
        await answerCallback(ev.callbackQueryId, cfg.TELEGRAM_BOT_TOKEN);
        return c.json({ ok: true });
      }
      // 3초 내 200 응답이 필요한 건 아니지만 빠르게 처리. fire-and-forget으로 ack는 비동기.
      queueMicrotask(async () => {
        try {
          await runAgentByName(agent.name, ev);
        } catch (err) {
          log.error(`callback agent run failed for ${agent.name}`, err);
        }
        await answerCallback(ev.callbackQueryId, cfg.TELEGRAM_BOT_TOKEN);
      });
      return c.json({ ok: true });
    }

    const msg = update.message;
    if (!msg?.text) return c.json({ ok: true });

    const text = msg.text.trim();
    const chatId = msg.chat.id.toString();
    const username = msg.from.username;

    log.info(`message from ${username ?? chatId}: ${text.slice(0, 50)}`);

    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const agentName = parts[1]?.trim();
      if (!agentName) {
        await reply(chatId, '본인 이름과 함께 다시 시도해주세요. 예: `/start uj_choe`');
        return c.json({ ok: true });
      }

      // 이름 정규식 검증 (영문 + 점/언더바)
      if (!/^[a-z0-9][a-z0-9._-]{1,30}$/i.test(agentName)) {
        await reply(chatId, '이름은 영문 + 숫자 + . _ - 만 가능해요. (예: uj_choe)');
        return c.json({ ok: true });
      }

      // pending registration 저장 (setup 마법사가 polling)
      const db = getDb();
      await db.insert(telegramPending).values({
        agentName,
        chatId,
        username,
      });

      // 만약 이미 agent 등록되어 있으면 바로 업데이트
      const [existing] = await db.select().from(agents).where(eq(agents.name, agentName));
      if (existing) {
        await db
          .update(agents)
          .set({ telegramChatId: chatId, telegramUsername: username ?? null, updatedAt: new Date() })
          .where(eq(agents.name, agentName));
      }

      await reply(
        chatId,
        `✅ 등록 완료!\n이름: ${agentName}\n이제 셋업 마법사로 돌아가세요. 잠시 후 자동으로 진행돼요.`,
      );
      await getEventBus().publish({
        type: 'telegram.registered',
        agentName,
        payload: { chatId, username },
      });
      return c.json({ ok: true });
    }

    if (text === '/whoami') {
      const db = getDb();
      const [row] = await db.select().from(agents).where(eq(agents.telegramChatId, chatId));
      await reply(
        chatId,
        row
          ? `👋 안녕, ${row.displayName ?? row.name} (${row.name})\nchat_id: ${chatId}`
          : `chat_id: ${chatId}\n등록된 에이전트가 없어요. /start <이름>으로 시작하세요.`,
      );
      return c.json({ ok: true });
    }

    if (text === '/help' || text === '/start') {
      await reply(
        chatId,
        [
          '🤖 *Rego Agent Bot*',
          '',
          '명령어:',
          '`/start <이름>` — 본인 닉네임 등록 (예: `/start uj_choe`)',
          '`/whoami` — 내 등록 상태 확인',
          '`/help` — 도움말',
        ].join('\n'),
      );
      return c.json({ ok: true });
    }

    return c.json({ ok: true });
  });

  return router;
}

async function reply(chatId: string, text: string) {
  const cfg = env();
  if (!cfg.TELEGRAM_BOT_TOKEN) return;
  const tg = new TelegramClient(cfg.TELEGRAM_BOT_TOKEN);
  try {
    await tg.sendMessage({ chat_id: chatId, text, parse_mode: 'Markdown' });
  } catch (err) {
    log.error('failed to reply', err);
  }
}

async function answerCallback(callbackQueryId: string, token: string | undefined) {
  if (!token) return;
  try {
    const tg = new TelegramClient(token);
    await tg.answerCallbackQuery({ callback_query_id: callbackQueryId });
  } catch (err) {
    log.warn('answerCallbackQuery failed', err);
  }
}

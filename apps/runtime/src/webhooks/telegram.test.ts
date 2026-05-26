import { describe, it, expect } from 'vitest';
import { parseTelegramCallback } from './telegram.js';

describe('parseTelegramCallback (Phase 3)', () => {
  it('정상 callback_query 파싱', () => {
    const ev = parseTelegramCallback({
      update_id: 1,
      callback_query: {
        id: 'cq1',
        data: 'approve:123',
        message: { chat: { id: 663 }, message_id: 42, text: '원본 메시지' },
        from: { id: 555, first_name: '준', username: 'uj' },
      },
    });
    expect(ev).toEqual({
      type: 'telegram.callback',
      callbackQueryId: 'cq1',
      data: 'approve:123',
      chatId: '663',
      messageId: 42,
      userId: '555',
      userName: '준',
      messageText: '원본 메시지',
    });
  });

  it('callback_query 자체가 없으면 null', () => {
    const ev = parseTelegramCallback({ update_id: 1, message: { message_id: 1, from: { id: 1 }, chat: { id: 1, type: 'private' } } as any });
    expect(ev).toBeNull();
  });

  it('callback_query.id 누락 → null', () => {
    const ev = parseTelegramCallback({ update_id: 1, callback_query: {} as any });
    expect(ev).toBeNull();
  });

  it('message.chat.id 누락 → null', () => {
    const ev = parseTelegramCallback({
      update_id: 1,
      callback_query: { id: 'cq', message: { message_id: 1 } as any } as any,
    });
    expect(ev).toBeNull();
  });

  it('data 누락 → 빈 문자열로 정상화', () => {
    const ev = parseTelegramCallback({
      update_id: 1,
      callback_query: {
        id: 'cq',
        message: { chat: { id: 1 }, message_id: 2 },
      },
    });
    expect(ev?.data).toBe('');
  });

  it('from 누락 → userId 빈 문자열', () => {
    const ev = parseTelegramCallback({
      update_id: 1,
      callback_query: {
        id: 'cq',
        data: 'x',
        message: { chat: { id: 1 }, message_id: 2 },
      },
    });
    expect(ev?.userId).toBe('');
    expect(ev?.userName).toBeUndefined();
  });
});

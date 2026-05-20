import { Hono } from 'hono';
import { stream, streamSSE } from 'hono/streaming';
import { getEventBus } from '../event-bus.js';

/**
 * SSE endpoint — 모든 이벤트를 실시간 푸시.
 * 대시보드가 EventSource로 구독.
 */
export function createSseEndpoint() {
  const r = new Hono();

  r.get('/', (c) => {
    return streamSSE(c, async (stream) => {
      const bus = getEventBus();

      // 초기 ping
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ ok: true }) });

      const unsubscribe = bus.subscribeAll(async (event) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // ignore broken stream
        }
      });

      // keepalive
      const interval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '{}' });
        } catch {
          clearInterval(interval);
        }
      }, 25_000);

      // 클라이언트가 끊으면 unsubscribe
      stream.onAbort(() => {
        unsubscribe();
        clearInterval(interval);
      });

      // 무한 대기 (abort 까지)
      await new Promise((resolve) => {
        stream.onAbort(() => resolve(undefined));
      });
    });
  });

  return r;
}

import { EventEmitter } from 'node:events';
import { getDb, events } from '@rego/db';

export interface BusEvent {
  type: string;
  agentName?: string;
  payload?: unknown;
  ts: string;
}

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100); // SSE 클라이언트 여러 명
  }

  async publish(event: Omit<BusEvent, 'ts'>) {
    const fullEvent: BusEvent = { ...event, ts: new Date().toISOString() };

    // 1. in-memory emit (SSE 등 즉시 처리)
    this.emitter.emit('event', fullEvent);
    this.emitter.emit(event.type, fullEvent);

    // 2. DB 영구 저장
    try {
      const db = getDb();
      await db.insert(events).values({
        eventType: event.type,
        agentName: event.agentName ?? null,
        payload: event.payload ?? null,
      });
    } catch (err) {
      console.error('Failed to persist event', err);
    }
  }

  subscribeAll(fn: (e: BusEvent) => void) {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }

  subscribe(type: string, fn: (e: BusEvent) => void) {
    this.emitter.on(type, fn);
    return () => this.emitter.off(type, fn);
  }
}

let _bus: EventBus | null = null;
export function getEventBus(): EventBus {
  if (!_bus) _bus = new EventBus();
  return _bus;
}

'use client';
import { useEffect, useRef, useState } from 'react';

export interface BusEvent {
  type: string;
  agentName?: string;
  payload?: unknown;
  ts: string;
}

export function useSseEvents(maxEvents = 50): BusEvent[] {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = '/api/runtime-events';
    const es = new EventSource(url);
    sourceRef.current = es;

    const handler = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as BusEvent;
        setEvents((prev) => {
          const next = [data, ...prev];
          return next.slice(0, maxEvents);
        });
      } catch {}
    };

    // 비개발자가 보는 활동만 구독 (개발틱한 llm/tool/run.started/audit 제외)
    const types = [
      'github.push',
      'agent.analyzed',
      'telegram.registered',
      'slack.mention.received',
      'run.finished',
    ];
    for (const t of types) es.addEventListener(t, handler);

    es.onerror = () => {
      // EventSource는 자동 재연결 시도
    };

    return () => {
      for (const t of types) es.removeEventListener(t, handler);
      es.close();
    };
  }, [maxEvents]);

  return events;
}

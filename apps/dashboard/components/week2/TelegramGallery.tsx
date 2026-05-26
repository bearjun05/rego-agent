'use client';
import { useEffect, useState } from 'react';

interface Entry {
  agent: string;
  displayName: string | null;
  message: string;
  sentAt: string;
}

export function TelegramGallery() {
  const [data, setData] = useState<Entry[]>([]);
  useEffect(() => {
    fetch('/api/runtime/week2/telegram-gallery')
      .then((r) => r.json())
      .then((d: { gallery: Entry[] }) => setData(d.gallery ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="brut p-4 bg-paper">
      <div className="font-display font-bold text-sm mb-3">
        📱 텔레그램 메시지 갤러리 <span className="font-mono text-[10px] text-muted">(PII 마스킹)</span>
      </div>
      <div className="grid md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto">
        {data.slice(0, 12).map((e) => (
          <div key={e.agent} className="brut p-2 bg-sand">
            <div className="font-display font-bold text-xs mb-1">
              {e.displayName ?? e.agent}
            </div>
            <pre className="font-mono text-[10px] whitespace-pre-wrap leading-snug">
              {e.message.slice(0, 240)}
            </pre>
          </div>
        ))}
        {data.length === 0 && (
          <div className="font-mono text-xs text-muted">아직 텔레그램 발송 없음</div>
        )}
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';

interface Message {
  text: string;
  sentAt: string | null;
}

interface Learner {
  agent: string;
  displayName: string | null;
  messageCount: number;
  latestAt: string | null;
  tags: string[];
  messages: Message[];
}

function timeAgo(ts: string | null): string {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return '방금';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function TelegramGallery() {
  const [data, setData] = useState<Learner[]>([]);
  const [selected, setSelected] = useState<Learner | null>(null);

  useEffect(() => {
    fetch('/api/runtime/week2/telegram-gallery')
      .then((r) => r.json())
      .then((d: { learners: Learner[] }) => setData(d.learners ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="brut p-4 bg-paper">
      <div className="mb-3 pb-2 border-b border-ink/15">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Telegram</div>
        <div className="font-display font-bold text-base">이렇게 메시지 받고 있어요</div>
        {!selected && (
          <div className="font-mono text-[10px] text-muted mt-0.5">
            사람 카드를 클릭하면 그 사람이 실제로 받는 메시지 5개가 펼쳐져요. 공개 채널 메시지만 표시됩니다.
          </div>
        )}
      </div>

      {!selected && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map((l) => (
            <LearnerCard key={l.agent} learner={l} onOpen={() => setSelected(l)} />
          ))}
          {data.length === 0 && (
            <div className="font-mono text-xs text-muted col-span-full">
              아직 텔레그램 발송 없음. 빙고 2번을 클리어한 학습자부터 여기 카드로 나타나요.
            </div>
          )}
        </div>
      )}

      {selected && (
        <div>
          <button
            onClick={() => setSelected(null)}
            className="font-mono text-xs px-3 py-1 border-2 border-ink hover:bg-sand mb-3"
          >
            ← 갤러리로
          </button>
          <div className="brut p-4 bg-paper mb-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Learner</div>
                <div className="font-display font-extrabold text-xl">
                  {selected.displayName ?? selected.agent}
                </div>
              </div>
              <span className="font-mono text-[10px] text-muted">
                최근 {selected.messages.length}건 · {timeAgo(selected.latestAt)}
              </span>
            </div>
            {selected.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selected.tags.map((t) => (
                  <Tag key={t} label={t} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {selected.messages.map((m, i) => (
              <div key={i} className="brut p-3 bg-paper">
                <div className="font-mono text-[10px] text-muted mb-1.5">
                  #{selected.messages.length - i} · {timeAgo(m.sentAt)}
                </div>
                <pre className="font-mono text-[12px] whitespace-pre-wrap leading-relaxed">
                  {m.text}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LearnerCard({
  learner,
  onOpen,
}: {
  learner: Learner;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="brut p-3 bg-sand hover:bg-paper text-left transition-colors group"
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="font-display font-bold text-sm truncate">
          {learner.displayName ?? learner.agent}
        </div>
        <span className="font-mono text-[10px] text-muted shrink-0 tabular-nums">
          {learner.messageCount}건 · {timeAgo(learner.latestAt)}
        </span>
      </div>
      {learner.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {learner.tags.map((t) => (
            <Tag key={t} label={t} compact />
          ))}
        </div>
      ) : (
        <div className="font-mono text-[10px] text-muted italic">
          아직 분석할 패턴 없음 (메시지 1건)
        </div>
      )}
      <div className="font-mono text-[10px] text-muted mt-2 group-hover:text-rust transition-colors">
        메시지 5개 보기 →
      </div>
    </button>
  );
}

function Tag({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center font-mono ${
        compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-1'
      } border-2 border-ink bg-paper`}
      style={{ borderRadius: 'var(--th-card-radius, 0)' }}
    >
      {label}
    </span>
  );
}

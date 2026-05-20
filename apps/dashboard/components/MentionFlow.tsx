'use client';
/**
 * 1주차 핵심 뷰:
 * 슬랙 멘션 → 텔레그램 메시지 매핑을 한눈에.
 * 각자의 에이전트가 "이 입력에 이렇게 반응했다"를 보여줌.
 */
import { useEffect, useState } from 'react';
import { fmtRelativeTime } from '@/lib/utils';

interface FlowItem {
  telegram: {
    id: number;
    agentName: string;
    text: string;
    sentAt: string;
  };
  slack: {
    id: number;
    text: string;
    userName: string | null;
    channelName: string | null;
    ts: string;
    permalink: string | null;
  } | null;
}

interface AgentInfo {
  name: string;
  displayName: string | null;
  icon: string;
  color: string;
}

export function MentionFlow() {
  const [flow, setFlow] = useState<FlowItem[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [filterAgent, setFilterAgent] = useState<string>('all');

  useEffect(() => {
    fetch('/api/runtime/agents')
      .then((r) => r.json())
      .then((data: { agents?: AgentInfo[] }) => setAgents(data.agents ?? []))
      .catch(() => {});

    const load = () => {
      const url =
        filterAgent === 'all'
          ? '/api/runtime/feed/mentions?limit=30'
          : `/api/runtime/feed/mentions?agent=${encodeURIComponent(filterAgent)}&limit=30`;
      fetch(url)
        .then((r) => r.json())
        .then((data: { flow?: FlowItem[] }) => setFlow(data.flow ?? []))
        .catch(() => {});
    };
    load();
    const i = setInterval(load, 8_000);
    return () => clearInterval(i);
  }, [filterAgent]);

  return (
    <div className="brut p-0 overflow-hidden">
      <div className="p-4 border-b-2 border-ink bg-rust text-paper flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-bold text-lg">🎯 멘션 → 텔레그램 매핑</h2>
          <div className="font-mono text-[10px] uppercase opacity-80 mt-0.5">
            1주차 핵심 — 슬랙 입력과 각자의 텔레그램 응답을 한눈에
          </div>
        </div>
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="font-mono text-xs uppercase bg-paper text-ink border-2 border-ink px-2 py-1"
        >
          <option value="all">모든 사람</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.icon} {a.displayName ?? a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="divide-y-2 divide-ink max-h-[640px] overflow-y-auto">
        {flow.length === 0 && (
          <div className="p-8 text-center text-muted text-sm">
            <div className="text-3xl mb-2">📭</div>
            아직 처리된 멘션이 없어요.<br />
            <span className="text-xs">슬랙에서 에이전트 이름을 태그하거나, 수모크 테스트를 돌려보세요.</span>
          </div>
        )}

        {flow.map((item, i) => {
          const agent = agents.find((a) => a.name === item.telegram.agentName);
          return (
            <div
              key={item.telegram.id}
              className="p-4 hover:bg-sand/50 transition-colors fade-up"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="flex items-baseline justify-between mb-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg">{agent?.icon ?? '🤖'}</span>
                  <span className="font-display font-bold">
                    {agent?.displayName ?? item.telegram.agentName}
                  </span>
                </div>
                <span className="font-mono text-[10px] uppercase text-muted">
                  {fmtRelativeTime(item.telegram.sentAt)}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
                {/* Slack 원문 */}
                <div className="brut-tight bg-paper p-3">
                  <div className="font-mono text-[10px] uppercase text-muted mb-1">
                    💬 SLACK
                    {item.slack?.channelName && ` · #${item.slack.channelName}`}
                  </div>
                  {item.slack ? (
                    <>
                      <div className="text-xs text-muted mb-1">
                        {item.slack.userName ?? '익명'}
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {item.slack.text}
                      </div>
                      {item.slack.permalink && (
                        <a
                          href={item.slack.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[10px] uppercase text-rust hover:underline mt-2 inline-block"
                        >
                          원문 보기 ↗
                        </a>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-muted italic">
                      스모크 테스트 / 수동 트리거
                    </div>
                  )}
                </div>

                {/* 화살표 */}
                <div className="hidden md:flex items-center justify-center font-display text-2xl text-rust">
                  →
                </div>

                {/* Telegram 결과 */}
                <div
                  className="brut-tight p-3"
                  style={{ background: `${agent?.color ?? '#000000'}10` }}
                >
                  <div className="font-mono text-[10px] uppercase text-muted mb-1">📱 TELEGRAM</div>
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {item.telegram.text}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

#!/usr/bin/env tsx
/**
 * 시연용 가짜 데이터 시드.
 * - 가상의 학습자 4명 (jun, sumi, minho, jiwon)
 * - 슬랙 멘션 + 분류 결과 + 텔레그램 매핑
 * - 활동 이벤트
 * - 비용 집계
 *
 * 운영자가 일어났을 때 대시보드를 바로 시연 가능한 상태로 만듦.
 */
import { randomUUID } from 'node:crypto';
import { getDb, agents, events, runs, llmCalls, toolCalls, slackMentions, telegramMessages, smokeRuns, auditLogs } from '@rego/db';

const DEMO_AGENTS = [
  {
    name: 'uj.choe',
    displayName: '김하늘',
    githubHandle: 'bearjun05',
    telegramChatId: '6631216371',
    telegramUsername: 'ujchoe',
    icon: '🧠',
    color: '#C5532E',
    description: '제품실 비서 — 환불/일정 빠른 분류',
  },
  {
    name: 'sumi',
    displayName: '이서준',
    githubHandle: 'sumi-jang',
    telegramChatId: '7000000001',
    telegramUsername: 'sumi',
    icon: '⚡',
    color: '#3E5C3E',
    description: 'KDT 운영팀 멘션 우선순위 분류',
  },
  {
    name: 'minho',
    displayName: '박도윤',
    githubHandle: 'minho-kim',
    telegramChatId: '7000000002',
    telegramUsername: 'minho',
    icon: '🌊',
    color: '#1E4D8B',
    description: '개발팀 코드 리뷰 요청 추적',
  },
  {
    name: 'jiwon',
    displayName: '정유나',
    githubHandle: 'jiwon-park',
    telegramChatId: '7000000003',
    telegramUsername: 'jiwon',
    icon: '🌸',
    color: '#A4506E',
    description: '디자인팀 피드백 정리',
  },
];

const DEMO_MENTIONS: Array<{
  to: string;
  text: string;
  userName: string;
  channelName: string;
  category: string;
  reply: string;
  hoursAgo: number;
}> = [
  {
    to: 'uj.choe',
    text: '@uj.choe 환불 정책 어떻게 적용해야 하나요? KDT 부트캠프 중도 이탈 케이스가 헷갈려요',
    userName: '이서준',
    channelName: '운영팀',
    category: 'question',
    reply: '❓ *QUESTION*\n\n*from:* 이서준\n*ch:* #운영팀\n\n환불 정책 적용 방법이 헷갈리는데, KDT 부트캠프 중도 이탈 환불은 어떻게 처리…\n\n_환불 절차에 대한 질문 — 정책 페이지 공유 권장_',
    hoursAgo: 0.1,
  },
  {
    to: 'uj.choe',
    text: '@uj.choe 내일까지 이 기획안 검토 좀 부탁드릴 수 있을까요?',
    userName: '박도윤',
    channelName: '제품실',
    category: 'request',
    reply: '📝 *REQUEST*\n\n*from:* 박도윤\n*ch:* #제품실\n\n내일까지 이 기획안 검토 좀 부탁드릴 수 있을까요?\n\n_검토 요청 — 답변 권장 시간 24h_',
    hoursAgo: 0.5,
  },
  {
    to: 'sumi',
    text: '@sumi 내일 오후 2시 30분에 KDT 정기 회의 가능하세요?',
    userName: '이서준',
    channelName: '운영팀',
    category: 'schedule',
    reply: '📅 *SCHEDULE*\n\n*from:* 이서준\n*ch:* #운영팀\n\n내일 오후 2시 30분에 KDT 정기 회의 가능하세요?\n\n_일정 조율 — 캘린더 확인 필요_',
    hoursAgo: 0.8,
  },
  {
    to: 'sumi',
    text: '@sumi 새 정책 슬라이드 공유드려요. 다음 주부터 적용됩니다',
    userName: '팀장님',
    channelName: '공지',
    category: 'info',
    reply: '📰 *INFO*\n\n*from:* 팀장님\n*ch:* #공지\n\n새 정책 슬라이드 공유드려요. 다음 주부터 적용됩니다\n\n_단순 공유 — 답변 X_',
    hoursAgo: 1.2,
  },
  {
    to: 'minho',
    text: '@minho 이 코드 리뷰 좀 부탁드려요. 내일 배포 예정인데 봐주실 수 있나요?',
    userName: '개발자A',
    channelName: '개발팀',
    category: 'request',
    reply: '📝 *REQUEST*\n_PRIORITY: HIGH_\n\nfrom: 개발자A\nch: #개발팀\n\n이 코드 리뷰 좀 부탁드려요. 내일 배포 예정인데 봐주실 수 있나요?\n\n→ 배포 마감일 임박',
    hoursAgo: 1.8,
  },
  {
    to: 'minho',
    text: '@minho 이거 어떻게 생각하세요?',
    userName: '개발자B',
    channelName: '개발팀',
    category: 'question',
    reply: '❓ *QUESTION (low confidence)*\n\nfrom: 개발자B\nch: #개발팀\n\n이거 어떻게 생각하세요?\n\n_문맥 부족 — 추가 정보 필요_',
    hoursAgo: 2.5,
  },
  {
    to: 'jiwon',
    text: '@jiwon 이 디자인 시안 어떻게 보세요? 클라이언트 미팅 전에 의견 듣고 싶어서요',
    userName: '디자이너C',
    channelName: '디자인팀',
    category: 'request',
    reply: '📝 *REQUEST*\n\nfrom: 디자이너C\nch: #디자인팀\n\n이 디자인 시안 어떻게 보세요? 클라이언트 미팅 전에 의견 듣고 싶어서요',
    hoursAgo: 3.2,
  },
  {
    to: 'uj.choe',
    text: '@uj.choe 다음주 강의자료 마무리 점검 부탁드려요!',
    userName: '강사D',
    channelName: '제품실',
    category: 'request',
    reply: '📝 *REQUEST*\n\nfrom: 강사D\nch: #제품실\n\n다음주 강의자료 마무리 점검 부탁드려요!',
    hoursAgo: 5,
  },
  {
    to: 'sumi',
    text: '@sumi 환불 신청자 명단 한번 확인 부탁해요',
    userName: '운영자E',
    channelName: '운영팀',
    category: 'request',
    reply: '📝 *REQUEST*\n\nfrom: 운영자E\nch: #운영팀\n\n환불 신청자 명단 한번 확인 부탁해요',
    hoursAgo: 7,
  },
  {
    to: 'jiwon',
    text: '@jiwon 로고 사이즈 변경한 거 다시 한 번 확인해주세요',
    userName: '아트팀',
    channelName: '디자인팀',
    category: 'request',
    reply: '📝 *REQUEST*\n\nfrom: 아트팀\nch: #디자인팀\n\n로고 사이즈 변경한 거 다시 한 번 확인해주세요',
    hoursAgo: 9,
  },
];

const COSTS_PER_CATEGORY = {
  question: 0.0008,
  request: 0.0007,
  schedule: 0.0006,
  info: 0.0004,
};

async function main() {
  const db = getDb();
  const log = (msg: string) => console.log(`[seed] ${msg}`);

  log('agents 시드 중...');
  for (const a of DEMO_AGENTS) {
    await db
      .insert(agents)
      .values({
        name: a.name,
        displayName: a.displayName,
        githubHandle: a.githubHandle,
        telegramChatId: a.telegramChatId,
        telegramUsername: a.telegramUsername,
        icon: a.icon,
        color: a.color,
        description: a.description,
      })
      .onConflictDoUpdate({
        target: agents.name,
        set: {
          displayName: a.displayName,
          icon: a.icon,
          color: a.color,
          description: a.description,
          updatedAt: new Date(),
        },
      });
  }
  log(`✓ ${DEMO_AGENTS.length} agents`);

  log('멘션 + 텔레그램 매핑 시드 중...');
  const now = Date.now();
  for (const m of DEMO_MENTIONS) {
    const receivedAt = new Date(now - m.hoursAgo * 60 * 60 * 1000);
    const [mention] = await db
      .insert(slackMentions)
      .values({
        eventId: `demo-${randomUUID()}`,
        teamId: 'T_DEMO',
        channel: `C_${m.channelName}`,
        channelName: m.channelName,
        user: `U_${m.userName}`,
        userName: m.userName,
        ts: (receivedAt.getTime() / 1000).toString(),
        text: m.text,
        permalink: 'https://slack.com/demo',
        raw: { simulated: true },
        receivedAt,
      })
      .returning();
    if (!mention) continue;

    const runId = randomUUID();
    const sentAt = new Date(receivedAt.getTime() + 2500);
    await db.insert(runs).values({
      id: runId,
      agentName: m.to,
      triggerType: 'slack.mention',
      triggerPayload: { type: 'slack.mention', text: m.text },
      status: 'success',
      startedAt: receivedAt,
      finishedAt: sentAt,
      durationMs: 2500,
      costUsd: COSTS_PER_CATEGORY[m.category as keyof typeof COSTS_PER_CATEGORY].toFixed(6),
      result: { category: m.category },
    });

    await db.insert(llmCalls).values({
      runId,
      agentName: m.to,
      model: 'anthropic/claude-haiku-4.5',
      purpose: 'classify',
      inputTokens: 240,
      outputTokens: 80,
      costUsd: COSTS_PER_CATEGORY[m.category as keyof typeof COSTS_PER_CATEGORY].toFixed(6),
      durationMs: 1800,
      promptPreview: `[분류 프롬프트] ${m.text.slice(0, 100)}`,
      responsePreview: `{"category":"${m.category}","confidence":0.85}`,
      createdAt: receivedAt,
    });

    await db.insert(toolCalls).values({
      runId,
      agentName: m.to,
      toolId: 'telegram.send',
      input: { text: m.reply, parseMode: 'Markdown' },
      output: { ok: true, messageId: Math.floor(Math.random() * 1000000) },
      durationMs: 320,
      createdAt: sentAt,
    });

    await db.insert(telegramMessages).values({
      runId,
      agentName: m.to,
      chatId: DEMO_AGENTS.find((a) => a.name === m.to)?.telegramChatId ?? '0',
      text: m.reply,
      telegramMessageId: Math.floor(Math.random() * 1000000).toString(),
      triggeredBySlackMentionId: mention.id,
      sentAt,
    });

    // 이벤트 로그
    await db.insert(events).values([
      {
        eventType: 'slack.mention.received',
        agentName: m.to,
        payload: { mentionId: mention.id, text: m.text, userName: m.userName, channelName: m.channelName },
        createdAt: receivedAt,
      },
      {
        eventType: 'run.started',
        agentName: m.to,
        payload: { runId, triggerType: 'slack.mention' },
        createdAt: new Date(receivedAt.getTime() + 50),
      },
      {
        eventType: 'llm.called',
        agentName: m.to,
        payload: { model: 'anthropic/claude-haiku-4.5', costUsd: COSTS_PER_CATEGORY[m.category as keyof typeof COSTS_PER_CATEGORY], runId },
        createdAt: new Date(receivedAt.getTime() + 1800),
      },
      {
        eventType: 'tool.called',
        agentName: m.to,
        payload: { toolId: 'telegram.send', runId, durationMs: 320 },
        createdAt: new Date(receivedAt.getTime() + 2300),
      },
      {
        eventType: 'run.finished',
        agentName: m.to,
        payload: { runId, status: 'success', durationMs: 2500, costUsd: COSTS_PER_CATEGORY[m.category as keyof typeof COSTS_PER_CATEGORY] },
        createdAt: sentAt,
      },
    ]);
  }
  log(`✓ ${DEMO_MENTIONS.length} mention → telegram 매핑`);

  log('스모크 결과 시드 중...');
  for (const a of DEMO_AGENTS) {
    for (const fixture of ['q-refund-policy', 'r-review-request', 's-meeting-tomorrow', 'i-fyi-update', 'q-vague-confusion']) {
      const passed = Math.random() > 0.15;
      await db.insert(smokeRuns).values({
        agentName: a.name,
        fixtureId: fixture,
        fixtureScope: 'shared',
        triggeredBy: 'auto',
        runId: randomUUID(),
        passed,
        output: { category: passed ? 'question' : 'unknown' },
        durationMs: 1500 + Math.floor(Math.random() * 2000),
        costUsd: '0.0008',
        createdAt: new Date(now - Math.random() * 3 * 60 * 60 * 1000),
      });
    }
  }
  log(`✓ smoke runs (${DEMO_AGENTS.length * 5}건)`);

  log('audit 로그 시드 중...');
  await db.insert(auditLogs).values([
    {
      action: 'agent.registered',
      actor: 'system',
      agentName: 'uj.choe',
      severity: 'info',
      details: { via: 'setup-wizard' },
      createdAt: new Date(now - 5 * 60 * 60 * 1000),
    },
    {
      action: 'manifest.auto_synced',
      actor: 'system',
      agentName: 'sumi',
      severity: 'info',
      details: { added: ['telegram.send'], detected: ['telegram.send', 'llm.generate'] },
      createdAt: new Date(now - 4 * 60 * 60 * 1000),
    },
    {
      action: 'smoke.run',
      actor: 'admin',
      agentName: 'minho',
      severity: 'info',
      details: { fixtureId: 'r-review-request', status: 'success' },
      createdAt: new Date(now - 3 * 60 * 60 * 1000),
    },
  ]);
  log('✓ audit logs');

  log('완료!');
  log('대시보드: http://localhost:3000');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});

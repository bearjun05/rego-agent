import dns from 'node:dns';
import net from 'node:net';
// IPv4-only 우회책: 자체 우분투 서버는 IPv6 경로가 없어 외부 API(Telegram 등) ETIMEDOUT 발생.
// 단, Railway 사설망(*.railway.internal)은 IPv6로만 resolve되므로 이 설정을 켜면
// dashboard→runtime 내부 호출이 깨진다. → 자체서버에서만 SELF_HOSTED_IPV4_ONLY=1로 활성화.
if (process.env.SELF_HOSTED_IPV4_ONLY === '1') {
  dns.setDefaultResultOrder('ipv4first');
  (net as unknown as { setDefaultAutoSelectFamily?: (v: boolean) => void }).setDefaultAutoSelectFamily?.(
    false,
  );
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { env } from './env.js';
import { createLogger } from './logger.js';
import { loadAllAgents, listAgents } from './agent-registry.js';
import { refreshSlackUserMap } from './agent-runner.js';
import { syncManifestToolsForAgent, ensureAgentRow } from './manifest-sync.js';
import { analyzeAllStale } from './analyzer.js';
import { startSlackPoller } from './slack-poller.js';
import { createSlackRouter } from './webhooks/slack.js';
import { createTelegramRouter } from './webhooks/telegram.js';
import { createGithubRouter } from './webhooks/github.js';
import { createAgentsApi } from './api/agents.js';
import { createFeedApi } from './api/feed.js';
import { createSmokeApi } from './api/smoke.js';
import { createChatApi } from './api/chat.js';
import { createSseEndpoint } from './api/sse.js';
import { createOAuthApi } from './api/oauth.js';

const log = createLogger('server');

export async function buildApp() {
  const app = new Hono();

  app.use('*', honoLogger());
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      credentials: true,
    }),
  );

  // Health
  app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));
  app.get('/', (c) =>
    c.json({
      name: 'rego-agent runtime',
      version: '0.1.0',
      agentsLoaded: listAgents().length,
    }),
  );

  // Webhooks (verifyfng signature in handler)
  app.route('/webhooks/slack', createSlackRouter());
  app.route('/webhooks/github', createGithubRouter());
  app.route('/webhooks/telegram', createTelegramRouter());

  // API
  app.route('/api/agents', createAgentsApi());
  app.route('/api/feed', createFeedApi());
  app.route('/api/smoke', createSmokeApi());
  app.route('/api/chat', createChatApi());
  app.route('/api/events', createSseEndpoint());

  // Tier2 유저 OAuth (참가자가 본인 Slack 연결 — 비공개 채널 폴링용)
  app.route('/oauth', createOAuthApi());

  // Admin (audit는 /api/feed/audit 에 합쳤음)

  return app;
}

async function main() {
  const cfg = env();
  // Railway는 PORT를 동적 주입 → 우선 사용, 없으면 RUNTIME_PORT(로컬 기본 3001).
  const port = Number(process.env.PORT) || cfg.RUNTIME_PORT;
  // Railway 사설망(service-to-service)은 IPv6(::) 바인딩 필요. '::' 듀얼스택은 공개 IPv4도 수신.
  // 자체서버(IPv6 없음)에서는 0.0.0.0으로 폴백.
  const hostname =
    process.env.BIND_HOST ?? (process.env.RAILWAY_ENVIRONMENT ? '::' : '0.0.0.0');
  log.info('booting rego-agent runtime', {
    nodeEnv: cfg.NODE_ENV,
    port,
    hostname,
  });

  // Load agents + DB upsert + sync manifests
  await loadAllAgents();
  for (const a of listAgents()) {
    try {
      await ensureAgentRow(a); // 폴더 → DB row 동기화 (chat_id 매핑 가능하게)
      await syncManifestToolsForAgent(a);
    } catch (err) {
      log.warn(`agent sync failed for ${a.name}`, err);
    }
  }
  log.info(`loaded ${listAgents().length} agents`);

  // 슬랙 멘션 라우팅용 slack_user_id 매핑 로드
  await refreshSlackUserMap();

  // Tier2 폴러 (옵트인 유저의 비공개 채널 멘션 폴링) — env로 게이트
  if (process.env.SLACK_POLL_ENABLED === '1') {
    startSlackPoller();
  }

  // Railway: 재배포로 새 컨테이너가 떴으니 변경된 에이전트만 백그라운드 분석 (해시 동일 시 LLM 스킵).
  // (자체서버는 github webhook이 변경분을 처리하므로 부팅 분석 불필요)
  if (process.env.RAILWAY_ENVIRONMENT) {
    const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? 'railway';
    queueMicrotask(() =>
      analyzeAllStale(listAgents(), sha).catch((err) => log.warn('boot analyze failed', err)),
    );
  }

  const app = await buildApp();

  serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      log.info(`🚀 runtime listening on ${hostname}:${info.port}`);
    },
  );
}

// Run only when invoked directly
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('server.ts');

if (isMain) {
  main().catch((err) => {
    log.error('fatal', err);
    process.exit(1);
  });
}

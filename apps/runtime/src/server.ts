import dns from 'node:dns';
import net from 'node:net';
// 이 서버는 IPv6 경로가 없음 → 외부 API(Telegram 등) ETIMEDOUT 방지:
// 1) DNS 결과를 IPv4 우선으로
dns.setDefaultResultOrder('ipv4first');
// 2) happy-eyeballs(IPv4/IPv6 동시 시도) 끔 → 첫 주소(IPv4)만 연결
(net as unknown as { setDefaultAutoSelectFamily?: (v: boolean) => void }).setDefaultAutoSelectFamily?.(
  false,
);

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { env } from './env.js';
import { createLogger } from './logger.js';
import { loadAllAgents, listAgents } from './agent-registry.js';
import { refreshSlackUserMap } from './agent-runner.js';
import { syncManifestToolsForAgent, ensureAgentRow } from './manifest-sync.js';
import { createSlackRouter } from './webhooks/slack.js';
import { createTelegramRouter } from './webhooks/telegram.js';
import { createGithubRouter } from './webhooks/github.js';
import { createAgentsApi } from './api/agents.js';
import { createFeedApi } from './api/feed.js';
import { createSmokeApi } from './api/smoke.js';
import { createChatApi } from './api/chat.js';
import { createSseEndpoint } from './api/sse.js';

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

  // Admin (audit는 /api/feed/audit 에 합쳤음)

  return app;
}

async function main() {
  const cfg = env();
  log.info('booting rego-agent runtime', {
    nodeEnv: cfg.NODE_ENV,
    port: cfg.RUNTIME_PORT,
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

  const app = await buildApp();

  serve(
    {
      fetch: app.fetch,
      port: cfg.RUNTIME_PORT,
    },
    (info) => {
      log.info(`🚀 runtime listening on http://localhost:${info.port}`);
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

import { Hono } from 'hono';
import { env } from '../env.js';
import { createLogger } from '../logger.js';
import { reloadAll } from '../agent-registry.js';
import { getEventBus } from '../event-bus.js';
import { syncManifestToolsForAgent, ensureAgentRow } from '../manifest-sync.js';
import { listAgents } from '../agent-registry.js';

const log = createLogger('webhook:github');

async function verifyGitHubSignature(secret: string, signature: string, body: string) {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const computed = `sha256=${Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
  // constant-time compare
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export function createGithubRouter() {
  const router = new Hono();

  router.post('/', async (c) => {
    const cfg = env();
    const raw = await c.req.text();
    const sig = c.req.header('x-hub-signature-256') ?? '';
    const eventType = c.req.header('x-github-event') ?? '';

    if (cfg.GITHUB_WEBHOOK_SECRET) {
      const valid = await verifyGitHubSignature(cfg.GITHUB_WEBHOOK_SECRET, sig, raw);
      if (!valid) {
        log.warn('invalid signature');
        return c.json({ error: 'invalid signature' }, 401);
      }
    }

    let payload: { ref?: string; commits?: Array<{ id: string; message: string; modified: string[]; added: string[]; removed: string[]; author?: { name?: string; email?: string } }> };
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }

    if (eventType === 'push') {
      log.info(`push to ${payload.ref}, ${payload.commits?.length} commits`);

      await getEventBus().publish({
        type: 'github.push',
        payload: {
          ref: payload.ref,
          commits: payload.commits?.length ?? 0,
        },
      });

      // 에이전트 폴더 자동 리로드 + manifest sync
      queueMicrotask(async () => {
        try {
          await reloadAll();
          for (const a of listAgents()) {
            await ensureAgentRow(a); // 새 폴더 → DB row 동기화
            await syncManifestToolsForAgent(a);
          }
        } catch (err) {
          log.error('reload failed', err);
        }
      });
    }

    return c.json({ ok: true });
  });

  return router;
}

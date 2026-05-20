import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { getDb, fixtures as fixturesTable, smokeRuns, agents } from '@rego/db';
import type { AgentEvent, SlackMentionEvent } from '@rego/runtime-sdk';
import { getAgent, listAgents } from '../agent-registry.js';
import { runAgentForEvent } from '../agent-runner.js';
import { audit } from '../audit.js';
import { getEventBus } from '../event-bus.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHARED_FIXTURES_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../fixtures/slack-mentions.json',
);

interface SharedFixture {
  id: string;
  title: string;
  text: string;
  channel?: string;
  channelName?: string;
  user?: string;
  userName?: string;
  ts?: string;
  expectedCategory?: string;
}

async function loadSharedFixtures(): Promise<SharedFixture[]> {
  try {
    const raw = await fs.readFile(SHARED_FIXTURES_PATH, 'utf8');
    return JSON.parse(raw) as SharedFixture[];
  } catch {
    return [];
  }
}

export function createSmokeApi() {
  const r = new Hono();

  // GET /api/smoke/fixtures — 사용 가능한 fixture 목록
  r.get('/fixtures', async (c) => {
    const shared = await loadSharedFixtures();
    const db = getDb();
    const userFixtures = await db.select().from(fixturesTable);
    return c.json({
      shared,
      user: userFixtures,
    });
  });

  // POST /api/smoke/fixtures — 새 fixture 추가 (웹에서)
  const createFixtureSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    text: z.string().min(1),
    channel: z.string().optional(),
    channelName: z.string().optional(),
    user: z.string().optional(),
    userName: z.string().optional(),
    expectedCategory: z.string().optional(),
    scope: z.enum(['shared', 'agent']).default('shared'),
    ownerAgent: z.string().optional(),
    createdBy: z.string().optional(),
  });

  r.post('/fixtures', async (c) => {
    const body = await c.req.json();
    const parsed = createFixtureSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const data = parsed.data;
    const db = getDb();

    const payload = {
      type: 'app_mention' as const,
      text: data.text,
      channel: data.channel ?? 'C_DEMO',
      channelName: data.channelName ?? 'demo',
      user: data.user ?? 'U_DEMO',
      userName: data.userName ?? 'demo',
      ts: Date.now().toString() + '.000000',
    };

    await db.insert(fixturesTable).values({
      id: data.id,
      title: data.title,
      eventType: 'slack.mention',
      payload,
      expectedCategory: data.expectedCategory,
      scope: data.scope,
      ownerAgent: data.ownerAgent,
      createdBy: data.createdBy,
    });

    return c.json({ ok: true });
  });

  // POST /api/smoke/run — 단일 fixture를 단일 에이전트로 실행
  const runSchema = z.object({
    agentName: z.string(),
    fixtureId: z.string().optional(),
    /** 즉시 텍스트 시뮬레이션 (fixture 안 만들고 바로) */
    instantText: z.string().optional(),
    triggeredFromAgent: z.string().optional(),
  });

  r.post('/run', async (c) => {
    const body = await c.req.json();
    const parsed = runSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { agentName, fixtureId, instantText, triggeredFromAgent } = parsed.data;

    const agent = getAgent(agentName);
    if (!agent) return c.json({ error: `agent ${agentName} not loaded` }, 404);

    let event: SlackMentionEvent;
    let fixtureForRun: { id: string; scope: string; owner?: string } = {
      id: fixtureId ?? `instant-${Date.now()}`,
      scope: 'instant',
    };

    if (instantText) {
      event = {
        type: 'slack.mention',
        text: `@${agentName} ${instantText.replace(`@${agentName}`, '').trim()}`,
        channel: 'C_SMOKE',
        channelName: 'smoke-test',
        user: 'U_SMOKE',
        userName: triggeredFromAgent ?? 'smoke-runner',
        ts: (Date.now() / 1000).toString(),
        raw: { simulated: true },
      };
    } else if (fixtureId) {
      const shared = await loadSharedFixtures();
      const sFix = shared.find((s) => s.id === fixtureId);
      if (sFix) {
        event = {
          type: 'slack.mention',
          text: sFix.text.includes(`@${agentName}`) ? sFix.text : `@${agentName} ${sFix.text}`,
          channel: sFix.channel ?? 'C_SHARED',
          channelName: sFix.channelName ?? 'shared',
          user: sFix.user ?? 'U_SHARED',
          userName: sFix.userName ?? 'shared',
          ts: sFix.ts ?? (Date.now() / 1000).toString(),
          raw: { fixtureId, scope: 'shared' },
        };
        fixtureForRun = { id: sFix.id, scope: 'shared' };
      } else {
        const db = getDb();
        const [uf] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
        if (!uf) return c.json({ error: 'fixture not found' }, 404);
        const payload = uf.payload as {
          text: string;
          channel: string;
          channelName: string;
          user: string;
          userName: string;
          ts: string;
        };
        event = {
          type: 'slack.mention',
          text: payload.text.includes(`@${agentName}`) ? payload.text : `@${agentName} ${payload.text}`,
          channel: payload.channel,
          channelName: payload.channelName,
          user: payload.user,
          userName: payload.userName,
          ts: payload.ts,
          raw: { fixtureId, scope: uf.scope, ownerAgent: uf.ownerAgent },
        };
        fixtureForRun = { id: uf.id, scope: uf.scope, owner: uf.ownerAgent ?? undefined };
      }
    } else {
      return c.json({ error: 'fixtureId 또는 instantText 필요' }, 400);
    }

    const isCross = !!triggeredFromAgent && triggeredFromAgent !== agentName;

    const result = await runAgentForEvent(agent, event, {
      triggeredBy: isCross ? 'cross-smoke' : 'smoke',
    });

    // smoke_runs 기록
    const db = getDb();
    await db.insert(smokeRuns).values({
      agentName,
      fixtureId: fixtureForRun.id,
      fixtureScope: fixtureForRun.scope,
      fixtureOwner: fixtureForRun.owner,
      triggeredBy: instantText ? 'manual' : 'auto',
      triggeredFromAgent: triggeredFromAgent,
      runId: result.runId,
      passed: result.status === 'success',
      output: result.result,
      durationMs: result.durationMs,
      costUsd: result.costUsd.toFixed(6),
    });

    await audit({
      action: 'smoke.run',
      actor: triggeredFromAgent ?? 'admin',
      agentName,
      severity: 'info',
      details: { fixtureId: fixtureForRun.id, status: result.status },
    });

    return c.json({ result, fixture: fixtureForRun, event });
  });

  // POST /api/smoke/run-all — 한 에이전트에 모든 fixture 자동 실행 (push 후)
  const runAllSchema = z.object({
    agentName: z.string(),
    triggeredBy: z.enum(['auto', 'manual']).default('manual'),
  });
  r.post('/run-all', async (c) => {
    const body = await c.req.json();
    const parsed = runAllSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { agentName } = parsed.data;
    const agent = getAgent(agentName);
    if (!agent) return c.json({ error: 'agent not loaded' }, 404);

    const fixtures = await loadSharedFixtures();
    const results = [];
    for (const f of fixtures) {
      const event: SlackMentionEvent = {
        type: 'slack.mention',
        text: f.text.includes(`@${agentName}`) ? f.text : `@${agentName} ${f.text}`,
        channel: f.channel ?? 'C_SHARED',
        channelName: f.channelName ?? 'shared',
        user: f.user ?? 'U_SHARED',
        userName: f.userName ?? 'shared',
        ts: f.ts ?? (Date.now() / 1000).toString(),
        raw: { fixtureId: f.id, scope: 'shared' },
      };
      const result = await runAgentForEvent(agent, event, { triggeredBy: 'smoke' });
      const db = getDb();
      await db.insert(smokeRuns).values({
        agentName,
        fixtureId: f.id,
        fixtureScope: 'shared',
        triggeredBy: 'auto',
        runId: result.runId,
        passed: result.status === 'success',
        output: result.result,
        durationMs: result.durationMs,
        costUsd: result.costUsd.toFixed(6),
      });
      results.push({ fixture: f.id, status: result.status, runId: result.runId });
    }
    return c.json({ results, total: results.length });
  });

  // GET /api/smoke/results — 스모크 결과 조회
  r.get('/results', async (c) => {
    const agent = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const db = getDb();
    const rows = agent
      ? await db.select().from(smokeRuns).where(eq(smokeRuns.agentName, agent)).orderBy(desc(smokeRuns.createdAt)).limit(limit)
      : await db.select().from(smokeRuns).orderBy(desc(smokeRuns.createdAt)).limit(limit);
    return c.json({ results: rows });
  });

  return r;
}

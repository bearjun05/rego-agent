import { sql } from 'drizzle-orm';
import { getDb, rateLimit, agents } from '@rego/db';
import { eq } from 'drizzle-orm';
import { audit } from './audit.js';
import { env } from './env.js';

function currentWindow(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
}
function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export async function incrementCalls(agentName: string, type: 'tool' | 'llm') {
  const db = getDb();
  const window = currentWindow();

  // upsert + increment ("window"는 Postgres 예약어라 따옴표 필수)
  const incCol = type === 'llm' ? 'llm_count' : 'calls_count';
  await db.execute(sql.raw(`
    INSERT INTO rate_limit (agent_name, "window", calls_count, llm_count)
    VALUES ('${agentName.replace(/'/g, "''")}', '${window}', ${type === 'llm' ? 0 : 1}, ${type === 'llm' ? 1 : 0})
    ON CONFLICT (agent_name, "window")
    DO UPDATE SET ${incCol} = rate_limit.${incCol} + 1
  `));

  const cfg = env();
  // 현재 count 가져오기
  const [row] = await db.select().from(rateLimit).where(
    sql`${rateLimit.agentName} = ${agentName} AND ${rateLimit.window} = ${window}`,
  );
  if (!row) return;

  if (type === 'tool' && row.callsCount >= cfg.RUNAWAY_CALLS_PER_MIN) {
    await tripBreaker(agentName, 'tool_calls_per_min', row.callsCount);
  }
  if (type === 'llm' && row.llmCount >= cfg.RUNAWAY_LLM_PER_MIN) {
    await tripBreaker(agentName, 'llm_calls_per_min', row.llmCount);
  }
}

async function tripBreaker(agentName: string, kind: string, count: number) {
  const db = getDb();
  await db
    .update(agents)
    .set({
      isPaused: true,
      pausedReason: `runaway: ${kind}=${count}`,
      updatedAt: new Date(),
    })
    .where(eq(agents.name, agentName));

  await audit({
    action: 'runaway.detected',
    actor: 'system',
    agentName,
    severity: 'critical',
    details: { kind, count, autoPaused: true },
  });
}

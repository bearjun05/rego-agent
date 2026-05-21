import { sql, eq } from 'drizzle-orm';
import { getDb, rateLimit, agents } from '@rego/db';
import { audit } from './audit.js';
import { env } from './env.js';

function currentWindow(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
}
function pad(n: number) {
  return n.toString().padStart(2, '0');
}

/**
 * 분 단위 window의 호출 카운터를 +1 하고, 임계 초과 시 차단기를 작동시킨다.
 *
 * 파라미터라이즈드 upsert + RETURNING으로 한 쿼리에 처리(이전엔 sql.raw 문자열
 * 보간 = SQL injection 표면 + INSERT/SELECT 2쿼리였음).
 */
export async function incrementCalls(agentName: string, type: 'tool' | 'llm') {
  const db = getDb();
  const window = currentWindow();
  const cfg = env();

  const [row] = await db
    .insert(rateLimit)
    .values({
      agentName,
      window,
      callsCount: type === 'tool' ? 1 : 0,
      llmCount: type === 'llm' ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [rateLimit.agentName, rateLimit.window],
      set:
        type === 'tool'
          ? { callsCount: sql`${rateLimit.callsCount} + 1` }
          : { llmCount: sql`${rateLimit.llmCount} + 1` },
    })
    .returning({ callsCount: rateLimit.callsCount, llmCount: rateLimit.llmCount });

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

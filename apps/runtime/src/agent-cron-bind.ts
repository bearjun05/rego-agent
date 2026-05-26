import { getCronScheduler } from './cron-scheduler.js';
import { runAgentByName } from './agent-runner.js';
import type { LoadedAgent } from './agent-registry.js';
import { createLogger } from './logger.js';

const log = createLogger('cron-bind');

/**
 * agent의 cron 트리거를 스케줄러에 등록 (T4).
 *
 * 이전에 등록된 같은 agent의 cron은 먼저 해제 (모듈 reload·재등록 안전).
 * 반환: 등록한 트리거 개수.
 */
export function bindCronTriggers(agent: LoadedAgent): number {
  const sched = getCronScheduler();
  sched.cancelAgent(agent.name);
  let count = 0;
  for (const trigger of agent.manifest.triggers) {
    if (trigger.type !== 'cron' || !trigger.schedule) continue;
    try {
      sched.register(agent.name, trigger.schedule, async () => {
        await runAgentByName(agent.name, {
          type: 'cron',
          schedule: trigger.schedule!,
          firedAt: new Date().toISOString(),
        });
      });
      count += 1;
    } catch (err) {
      log.warn(`failed to register cron for ${agent.name} ${trigger.schedule}`, err);
    }
  }
  return count;
}

export function bindAllCronTriggers(agents: Iterable<LoadedAgent>): number {
  let total = 0;
  for (const agent of agents) total += bindCronTriggers(agent);
  log.info(`bound ${total} cron triggers`);
  return total;
}

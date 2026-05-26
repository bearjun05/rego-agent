import cron, { type ScheduledTask } from 'node-cron';
import { createLogger } from './logger.js';

const log = createLogger('cron');

/**
 * agent별 cron 스케줄 등록·해제 관리 (T4).
 *
 * 학습자가 agent.config.ts에 `trigger.cron('0 9 * * *')` 선언하면
 * agent-registry가 로드 시 register() 호출. 리로드 시 cancel + 재등록.
 *
 * 한 agent당 트리거 N개 가능 (key = `${agentName}#${expression}`).
 * 타임존: Asia/Seoul 고정 (스터디는 한국 시간 기준).
 */
export class CronScheduler {
  private jobs = new Map<string, ScheduledTask>();

  private static key(agentName: string, expression: string): string {
    return `${agentName}#${expression}`;
  }

  /**
   * 등록. 같은 agent+expression 이미 있으면 이전 task stop + 교체.
   * @throws 잘못된 cron 표현식
   */
  register(agentName: string, expression: string, run: () => Promise<void>): void {
    if (!cron.validate(expression)) {
      throw new Error(`invalid cron expression: ${expression}`);
    }
    const k = CronScheduler.key(agentName, expression);
    this.jobs.get(k)?.stop();
    const task = cron.schedule(
      expression,
      () => {
        run().catch((err) => log.error(`cron ${k} failed`, err));
      },
      { timezone: 'Asia/Seoul' },
    );
    this.jobs.set(k, task);
    log.info(`registered cron ${k}`);
  }

  /** 특정 agent의 모든 cron 해제 (모듈 reload 전에 호출) */
  cancelAgent(agentName: string): void {
    const prefix = `${agentName}#`;
    for (const [k, task] of this.jobs) {
      if (k.startsWith(prefix)) {
        task.stop();
        this.jobs.delete(k);
        log.info(`cancelled cron ${k}`);
      }
    }
  }

  cancelAll(): void {
    for (const task of this.jobs.values()) task.stop();
    this.jobs.clear();
  }

  count(): number {
    return this.jobs.size;
  }

  /** 디버깅용 — 등록된 키 목록 */
  list(): string[] {
    return [...this.jobs.keys()];
  }
}

// 싱글톤 (앱 전역)
let _scheduler: CronScheduler | undefined;

export function getCronScheduler(): CronScheduler {
  if (!_scheduler) _scheduler = new CronScheduler();
  return _scheduler;
}

/** 테스트 전용 — 스케줄러 리셋 */
export function _resetCronScheduler(): void {
  _scheduler?.cancelAll();
  _scheduler = undefined;
}

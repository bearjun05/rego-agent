import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock은 hoisted되므로 mock fn들도 vi.hoisted로 미리 만들어 둠
const { stopMock, scheduleMock } = vi.hoisted(() => {
  const stopMock = vi.fn();
  const scheduleMock = vi.fn();
  return { stopMock, scheduleMock };
});

vi.mock('node-cron', () => {
  scheduleMock.mockImplementation((_expr: string, _fn: () => void, _opts?: unknown) => ({
    stop: stopMock,
    start: vi.fn(),
  }));
  return {
    default: {
      validate: (e: string) => /^[\d *\/,\-]+$/.test(e),
      schedule: scheduleMock,
    },
  };
});

import { CronScheduler, _resetCronScheduler } from './cron-scheduler.js';

describe('CronScheduler (T4)', () => {
  beforeEach(() => {
    stopMock.mockClear();
    scheduleMock.mockClear();
    // mock 재설정 (필요 시)
    scheduleMock.mockImplementation((_expr: string, _fn: () => void, _opts?: unknown) => ({
      stop: stopMock,
      start: vi.fn(),
    }));
    _resetCronScheduler();
  });
  afterEach(() => {
    _resetCronScheduler();
  });

  it('등록 → count 1', () => {
    const s = new CronScheduler();
    s.register('uj_choe', '0 9 * * *', async () => {});
    expect(s.count()).toBe(1);
    expect(scheduleMock).toHaveBeenCalledOnce();
  });

  it('동일 agent + 동일 expression 재등록 → 이전 task stop + 교체', () => {
    const s = new CronScheduler();
    s.register('uj_choe', '0 9 * * *', async () => {});
    s.register('uj_choe', '0 9 * * *', async () => {});
    expect(s.count()).toBe(1);
    expect(stopMock).toHaveBeenCalledOnce();
  });

  it('동일 agent 다른 expression → 각각 별개로 등록', () => {
    const s = new CronScheduler();
    s.register('uj_choe', '0 9 * * *', async () => {});
    s.register('uj_choe', '0 18 * * *', async () => {});
    expect(s.count()).toBe(2);
  });

  it('cancelAgent → 그 agent의 모든 cron 해제', () => {
    const s = new CronScheduler();
    s.register('uj_choe', '0 9 * * *', async () => {});
    s.register('uj_choe', '0 18 * * *', async () => {});
    s.register('gc_yang', '0 9 * * *', async () => {});
    s.cancelAgent('uj_choe');
    expect(s.count()).toBe(1);
    expect(s.list()).toEqual(['gc_yang#0 9 * * *']);
    expect(stopMock).toHaveBeenCalledTimes(2);
  });

  it('cancelAll → 전체 해제', () => {
    const s = new CronScheduler();
    s.register('a', '0 9 * * *', async () => {});
    s.register('b', '0 10 * * *', async () => {});
    s.cancelAll();
    expect(s.count()).toBe(0);
  });

  it('잘못된 cron 표현식 → throw', () => {
    const s = new CronScheduler();
    expect(() => s.register('a', '!!!', async () => {})).toThrow('invalid cron expression');
    expect(s.count()).toBe(0);
  });

  it('tick 콜백이 실제로 invoke됨', () => {
    const s = new CronScheduler();
    const fn = vi.fn().mockResolvedValue(undefined);
    s.register('a', '0 9 * * *', fn);
    const wrappedFn = scheduleMock.mock.calls[0]![1] as () => void;
    wrappedFn();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('cron 핸들러 throw해도 스케줄러는 살아있음 (unhandled rejection 안 남)', async () => {
    const s = new CronScheduler();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    s.register('a', '0 9 * * *', fn);
    const wrappedFn = scheduleMock.mock.calls[0]![1] as () => void;
    expect(() => wrappedFn()).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(s.count()).toBe(1);
  });
});

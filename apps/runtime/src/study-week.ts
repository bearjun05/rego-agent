/**
 * 인프피솔루션 스터디 N주차 자동 계산 (KST 기준).
 * 1주차 시작 = 2026-05-20 (수). 매주 수 12:30-14:00 운동장1.
 */
const STUDY_START_KST = new Date('2026-05-20T00:00:00+09:00').getTime();

export function currentWeek(now: Date = new Date()): number {
  const diff = now.getTime() - STUDY_START_KST;
  return Math.max(1, Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1);
}

export function weekLabel(now: Date = new Date()): string {
  return `${currentWeek(now)}주차`;
}

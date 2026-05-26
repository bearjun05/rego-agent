/**
 * 스터디 N주차 자동 계산.
 *
 * 1주차 시작 = 2026-05-20 (수, KST).
 * 매주 수요일 12:30 PM 스터디.
 * 5/20-5/26 = 1주차, 5/27-6/2 = 2주차, ...
 *
 * 8주차까지 진행 후엔 그대로 유지 (또는 추후 조정).
 */
const STUDY_START_KST = new Date('2026-05-20T00:00:00+09:00').getTime();

export function currentWeek(now: Date = new Date()): number {
  const diff = now.getTime() - STUDY_START_KST;
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, week);
}

/** "1주차", "2주차" 등 한국어 라벨 */
export function weekLabel(now: Date = new Date()): string {
  return `${currentWeek(now)}주차`;
}

/** "WEEK 1", "WEEK 2" 영문 라벨 */
export function weekLabelEn(now: Date = new Date()): string {
  return `WEEK ${currentWeek(now)}`;
}

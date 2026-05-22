import { describe, it, expect } from 'vitest';
import {
  filterNewSince,
  selectMentioning,
  maxTs,
  nowSlackTs,
  isFirstEncounter,
  type HistMsg,
} from './slack-poller.js';

const msgs: HistMsg[] = [
  { ts: '100.0', text: 'old <@U1>' },
  { ts: '200.0', text: '<@U1> 새 멘션' },
  { ts: '201.0', text: '잡담' },
  { ts: '202.0', text: '<@U2> 남멘션' },
  { ts: '203.0', text: '<@U1> 또', subtype: 'message_changed' }, // 편집 → 제외
];

describe('filterNewSince', () => {
  it('커서 이후만 (경계 제외)', () => {
    expect(filterNewSince(msgs, '200.0').map((m) => m.ts)).toEqual(['201.0', '202.0', '203.0']);
  });
  it('커서 null/0이면 전체', () => {
    expect(filterNewSince(msgs, null).length).toBe(5);
    expect(filterNewSince(msgs, '0').length).toBe(5);
  });
});

describe('selectMentioning', () => {
  it('대상 멘션만 + subtype 제외', () => {
    const r = selectMentioning(msgs, 'U1');
    expect(r.map((m) => m.ts)).toEqual(['100.0', '200.0']); // 203은 subtype, 202는 U2
  });
  it('대상 아니면 빈 배열', () => {
    expect(selectMentioning(msgs, 'U999')).toEqual([]);
  });
});

describe('maxTs', () => {
  it('최신 ts', () => {
    expect(maxTs(msgs, '0')).toBe('203.0');
  });
  it('빈 배열이면 fallback', () => {
    expect(maxTs([], '50.0')).toBe('50.0');
  });
});

describe('첫 폴링 baseline (과거 소급 차단)', () => {
  it('isFirstEncounter: 커서 null이면 true, 값 있으면 false', () => {
    expect(isFirstEncounter(null)).toBe(true);
    expect(isFirstEncounter('100.0')).toBe(false);
    expect(isFirstEncounter('0')).toBe(false);
  });
  it('nowSlackTs: epoch.micros 형식이고 과거 커서보다 큼', () => {
    const ts = nowSlackTs(1779342914208);
    expect(ts).toMatch(/^\d+\.\d{6}$/);
    expect(Number(ts) > Number('1700000000.000000')).toBe(true);
  });
});

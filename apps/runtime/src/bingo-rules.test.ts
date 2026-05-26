import { describe, it, expect } from 'vitest';
import { CELL_DEFS, CELL_IDS, CHAT_INPUT_CELLS } from './bingo-rules.js';

describe('CELL_DEFS (T8 빙고 9칸 정의)', () => {
  it('1~9까지 모두 정의됨', () => {
    expect(CELL_IDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const id of CELL_IDS) {
      expect(CELL_DEFS[id]).toBeDefined();
      expect(CELL_DEFS[id].id).toBe(id);
    }
  });

  it('각 셀이 title/short/description/hint/method 가짐', () => {
    for (const id of CELL_IDS) {
      const d = CELL_DEFS[id];
      expect(d.title).toBeTruthy();
      expect(d.short).toBeTruthy();
      expect(d.short.length).toBeLessThanOrEqual(12); // UI 카드 라벨 짧게
      expect(d.description).toBeTruthy();
      expect(d.hint).toBeTruthy();
      expect(['db', 'tool_log', 'llm_review', 'chat_input']).toContain(d.method);
    }
  });

  it('채팅 입력 셀은 6, 7, 9', () => {
    expect([...CHAT_INPUT_CELLS].sort()).toEqual([6, 7, 9]);
    for (const c of CHAT_INPUT_CELLS) {
      expect(CELL_DEFS[c].method).toBe('chat_input');
    }
  });

  it('자동 검증 셀(나머지)은 chat_input 아님', () => {
    for (const id of CELL_IDS) {
      if (!CHAT_INPUT_CELLS.has(id)) {
        expect(CELL_DEFS[id].method).not.toBe('chat_input');
      }
    }
  });
});

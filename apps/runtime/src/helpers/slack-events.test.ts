import { describe, it, expect } from 'vitest';
import {
  extractMentionedUserIds,
  shouldProcessSlackEvent,
  isChannelAllowed,
  parseChannelAllowlist,
  mentionDedupeKey,
  type RawSlackEvent,
} from './slack-events.js';

describe('extractMentionedUserIds', () => {
  it('단일/복수 유저 멘션 추출', () => {
    expect(extractMentionedUserIds('안녕 <@U123ABC>')).toEqual(['U123ABC']);
    expect(extractMentionedUserIds('<@U1> 그리고 <@W2> 봐줘')).toEqual(['U1', 'W2']);
  });
  it('fallback 라벨이 붙어도 id만 추출', () => {
    expect(extractMentionedUserIds('<@U123|john> 확인')).toEqual(['U123']);
  });
  it('채널/유저그룹 참조는 무시', () => {
    expect(extractMentionedUserIds('<#C123|잡담> <!here> 공지')).toEqual([]);
  });
  it('멘션 없으면 빈 배열', () => {
    expect(extractMentionedUserIds('그냥 잡담입니다')).toEqual([]);
  });
});

describe('shouldProcessSlackEvent', () => {
  const base: RawSlackEvent = {
    type: 'message',
    text: '<@U999> 이것 좀 봐주세요',
    channel: 'C1',
    user: 'U_SENDER',
    ts: '1700000000.0001',
  };

  it('사람 멘션 포함한 일반 메시지 → 처리', () => {
    const d = shouldProcessSlackEvent(base);
    expect(d.process).toBe(true);
    expect(d.reason).toBe('message_with_mention');
  });

  it('멘션 없는 잡담 → 스킵(no_mention)', () => {
    const d = shouldProcessSlackEvent({ ...base, text: '점심 뭐 먹지' });
    expect(d.process).toBe(false);
    expect(d.reason).toBe('no_mention');
  });

  it('subtype 있는 메시지(편집/삭제 등) → 스킵', () => {
    expect(shouldProcessSlackEvent({ ...base, subtype: 'message_changed' }).process).toBe(false);
    expect(shouldProcessSlackEvent({ ...base, subtype: 'message_deleted' }).reason).toContain(
      'subtype:',
    );
  });

  it('봇이 보낸 메시지(bot_id) → 스킵(루프 방지)', () => {
    const d = shouldProcessSlackEvent({ ...base, bot_id: 'B123' });
    expect(d.process).toBe(false);
    expect(d.reason).toBe('bot_message');
  });

  it('봇 자신의 user → 스킵(self_message)', () => {
    const d = shouldProcessSlackEvent({ ...base, user: 'U_BOT' }, { botUserId: 'U_BOT' });
    expect(d.process).toBe(false);
    expect(d.reason).toBe('self_message');
  });

  it('app_mention(봇 멘션) 완전한 이벤트 → 처리', () => {
    const d = shouldProcessSlackEvent({ ...base, type: 'app_mention' });
    expect(d.process).toBe(true);
    expect(d.reason).toBe('app_mention');
  });

  it('필드 누락된 메시지 → 스킵(incomplete)', () => {
    const d = shouldProcessSlackEvent({ type: 'message', text: '<@U1>', channel: 'C1' });
    expect(d.process).toBe(false);
    expect(d.reason).toBe('incomplete');
  });

  it('관심없는 이벤트 타입 → 스킵', () => {
    const d = shouldProcessSlackEvent({ type: 'reaction_added', user: 'U1' });
    expect(d.process).toBe(false);
    expect(d.reason).toContain('ignored_type');
  });
});

describe('isChannelAllowed / parseChannelAllowlist', () => {
  it('allowlist 비어있으면 전체 허용', () => {
    expect(isChannelAllowed('C1', '잡담', [])).toBe(true);
  });
  it('채널 ID로 허용', () => {
    expect(isChannelAllowed('C0ABCD', '잡담', ['C0ABCD'])).toBe(true);
  });
  it('채널명으로 허용(# 접두/대소문자 무시)', () => {
    expect(isChannelAllowed('C1', '우리팀_잡담', ['#우리팀_잡담'])).toBe(true);
    expect(isChannelAllowed('C1', 'General', ['general'])).toBe(true);
  });
  it('목록에 없으면 거부', () => {
    expect(isChannelAllowed('C1', '비밀방', ['C0ABCD', '잡담'])).toBe(false);
  });
  it('parseChannelAllowlist: 쉼표/공백 처리', () => {
    expect(parseChannelAllowlist(' C1 , 잡담 ,, ')).toEqual(['C1', '잡담']);
    expect(parseChannelAllowlist(undefined)).toEqual([]);
  });
});

describe('mentionDedupeKey', () => {
  it('channel:ts 형식', () => {
    expect(mentionDedupeKey('C1', '1700000000.0001')).toBe('C1:1700000000.0001');
  });
  it('같은 메시지면 경로 무관 동일 키 (Tier1/Tier2 dedup 근거)', () => {
    expect(mentionDedupeKey('C1', '99.1')).toBe(mentionDedupeKey('C1', '99.1'));
    expect(mentionDedupeKey('C1', '99.1')).not.toBe(mentionDedupeKey('C2', '99.1'));
  });
});

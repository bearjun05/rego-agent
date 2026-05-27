/**
 * 도구 ID → 비개발자 친화 한국어 라벨 매핑.
 * 메인에는 한국어 label, raw ID는 mono 작은 글씨로 부가.
 */

export type ToolCategory = 'slack' | 'telegram' | 'llm' | 'calendar' | 'github' | 'other';

export interface ToolLabel {
  label: string; // 한국어 라벨 (메인)
  category: ToolCategory;
  /** 한 줄 설명 (툴팁 / hover) */
  hint?: string;
}

const MAP: Record<string, ToolLabel> = {
  // ── Slack ─────────────────────────────────────────
  'slack.reactions_add': { label: '이모지 자동 반응', category: 'slack', hint: '메시지에 이모지 자동으로 달기' },
  'slack.add_reaction': { label: '이모지 자동 반응', category: 'slack' },
  'slack.chat_postMessage': { label: '슬랙 답장', category: 'slack', hint: '같은 채널/스레드에 답장 보내기' },
  'slack.reply': { label: '슬랙 답장', category: 'slack' },
  'slack.dm': { label: '슬랙 DM 보내기', category: 'slack' },
  'slack.users_info': { label: '사용자 이름 조회', category: 'slack', hint: 'U... ID를 사람 이름으로 변환' },
  'slack.user_info': { label: '사용자 이름 조회', category: 'slack' },
  'slack.conversations_info': { label: '채널 이름 조회', category: 'slack', hint: 'C... ID를 채널명으로 변환' },
  'slack.channel_info': { label: '채널 이름 조회', category: 'slack' },
  'slack.conversations_history': { label: '채널 메시지 가져오기', category: 'slack' },
  'slack.search_messages': { label: '슬랙 메시지 검색', category: 'slack' },

  // ── Telegram ──────────────────────────────────────
  'telegram.send_message': { label: '텔레그램 알림 보내기', category: 'telegram' },
  'telegram.send': { label: '텔레그램 알림 보내기', category: 'telegram' },
  'telegram.edit_message': { label: '텔레그램 메시지 고치기', category: 'telegram', hint: '이미 보낸 메시지를 수정' },
  'telegram.send_buttons': { label: '텔레그램 버튼 만들기', category: 'telegram' },
  'telegram.send_with_buttons': { label: '텔레그램 버튼 만들기', category: 'telegram' },
  'telegram.send_with_button': { label: '텔레그램 버튼 만들기', category: 'telegram' },
  'telegram.answer_callback': { label: '텔레그램 버튼 응답', category: 'telegram' },

  // ── LLM ───────────────────────────────────────────
  'llm.classify': { label: 'AI 분류', category: 'llm', hint: '메시지를 질문/요청/일정 같은 카테고리로' },
  'llm.summarize': { label: 'AI 요약', category: 'llm' },
  'llm.generate': { label: 'AI 답변 생성', category: 'llm' },
  'llm.chat': { label: 'AI 대화', category: 'llm' },

  // ── Calendar / GitHub / 기타 ─────────────────────
  'calendar.list_events': { label: '일정 조회', category: 'calendar' },
  'calendar.create_event': { label: '일정 생성', category: 'calendar' },
  'github.create_issue': { label: '깃허브 이슈 만들기', category: 'github' },
  'github.comment_issue': { label: '깃허브 이슈 댓글', category: 'github' },
};

/** 매핑이 없으면 prefix 기반으로 라벨/카테고리 추정 */
export function toolLabel(id: string): ToolLabel {
  const hit = MAP[id];
  if (hit) return hit;
  // 알려지지 않은 ID — id 후반부를 한글스럽게 풀어보기
  const category: ToolCategory = id.startsWith('slack.')
    ? 'slack'
    : id.startsWith('telegram.')
    ? 'telegram'
    : id.startsWith('llm.')
    ? 'llm'
    : id.startsWith('calendar.')
    ? 'calendar'
    : id.startsWith('github.')
    ? 'github'
    : 'other';
  const tail = id.split('.').slice(1).join('.') || id;
  const label = tail.replace(/_/g, ' ');
  return { label, category };
}

export function toolCategoryColor(cat: ToolCategory): string {
  switch (cat) {
    case 'slack':
      return 'var(--th-primary-1)';
    case 'telegram':
      return 'var(--th-primary-4)';
    case 'llm':
      return 'var(--th-primary-3)';
    case 'calendar':
      return 'var(--th-primary-2)';
    case 'github':
      return 'var(--th-fg)';
    default:
      return 'var(--th-muted)';
  }
}

export function toolCategoryKo(cat: ToolCategory): string {
  switch (cat) {
    case 'slack':
      return '슬랙';
    case 'telegram':
      return '텔레그램';
    case 'llm':
      return 'AI 모델';
    case 'calendar':
      return '캘린더';
    case 'github':
      return '깃허브';
    default:
      return '기타';
  }
}

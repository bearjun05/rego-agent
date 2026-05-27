/**
 * T8 빙고 9칸 정의 (순수 데이터). 검증 로직은 bingo-checks.ts.
 */

export type CellId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const CELL_IDS: CellId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export type CellStatus = 'done' | 'pending';
export type CellCheckMethod = 'db' | 'tool_log' | 'llm_review' | 'chat_input';

export interface CellDef {
  id: CellId;
  title: string;
  short: string; // 카드 셀에 표시 (8자 이내)
  description: string; // 미션 안내
  hint: string; // 막힐 때 표시
  method: CellCheckMethod;
}

export const CELL_DEFS: Record<CellId, CellDef> = {
  1: {
    id: 1,
    title: 'Slack 인증',
    short: 'Slack 연결',
    description: '대시보드에서 [내 Slack 연결] 버튼을 눌러 OAuth 인증을 완료하세요.',
    hint: '인증 후 자동으로 빙고 한 칸이 채워져요. 본인 자리(slack_user_id)와 다른 계정으로 시도하면 거부됩니다.',
    method: 'db',
  },
  2: {
    id: 2,
    title: '슬랙 → 텔레그램',
    short: '멘션 받기',
    description: '슬랙 채널에서 본인이 멘션된 메시지를 1건 받고, 텔레그램 알림이 도착하는지 확인하세요.',
    hint: '본인이 본인을 멘션하셔도 됩니다 (테스트 채널). 1분 내 텔레그램 도착 안 하면 알려주세요.',
    method: 'db',
  },
  3: {
    id: 3,
    title: '자동 👀 이모지',
    short: '이모지 자동',
    description: '슬랙 멘션을 받으면 그 메시지에 자동으로 👀(eyes) 이모지가 달리게 핸들러를 수정하세요.',
    hint: '`ctx.tools["slack.reactions_add"]({ channel: event.channel, ts: event.ts, name: "eyes" })`',
    method: 'tool_log',
  },
  4: {
    id: 4,
    title: '텔레그램 답장 버튼',
    short: '답장 버튼',
    description: '텔레그램 알림에 [확인]/[패스] 같은 버튼을 추가하고, 누르면 메시지가 수정되게 onTelegramCallback을 작성하세요.',
    hint: 'telegram.send의 replyMarkup에 inline_keyboard. onTelegramCallback에서 telegram.edit_message로 응답.',
    method: 'tool_log',
  },
  5: {
    id: 5,
    title: '이름으로 변환',
    short: '이름 변환',
    description: '텔레그램 메시지에 채널 ID(C...) 대신 채널명을, 사용자 ID(U...) 대신 사람 이름을 표시하세요.',
    hint: '`slack.users_info({user})` / `slack.conversations_info({channel})`로 enrich 후 텍스트에 박기.',
    method: 'llm_review',
  },
  6: {
    id: 6,
    title: '이모지 BEST 5',
    short: '이모지 분석',
    description:
      'Slack API 를 연결했다는 건 슬랙에 있는 본인의 모든 대화를 AI로 분석해볼 수 있다는 뜻이에요. 아주 간단하게, 본인이 자주 쓴 이모지 BEST 5를 본인 에이전트한테 뽑아달라고 시켜보고, 그 결과를 채팅창에 적어 주세요.',
    hint: '에이전트한테 시키는 게 핵심이지만, 손으로 5개만 적어도 일단 OK.',
    method: 'chat_input',
  },
  7: {
    id: 7,
    title: '태그 BEST 3',
    short: '태그 분석',
    description:
      '같은 방식이에요. 본인이 슬랙에서 가장 많이 멘션을 주고받은 사람 BEST 3 를 본인 에이전트한테 분석시켜 보고, 그 결과를 채팅창에 적어 주세요.',
    hint: '본인 슬랙 DM/멘션 히스토리를 에이전트가 훑게 시키면 자동으로 나옵니다. 손으로 3명 적어도 OK.',
    method: 'chat_input',
  },
  8: {
    id: 8,
    title: '아침 보고서',
    short: '아침 보고',
    description: '매일 아침 9시(또는 본인이 정한 시각)에 어제의 슬랙 활동 요약을 텔레그램으로 받게 cron을 등록하세요.',
    hint: 'agent.config.ts에 `trigger.cron("0 9 * * *")` + handler.ts에 `onCron` 함수. 한 번 발화하면 클리어.',
    method: 'db',
  },
  9: {
    id: 9,
    title: '와우 아이디어 2개',
    short: '아이디어',
    description: '슬랙 데이터로 할 수 있는 와우한 아이디어 2개를 채팅창에 적어 주세요.',
    hint: '엉뚱해도 됩니다. 본인이 평소 슬랙에서 답답했던 것/하고 싶었던 것.',
    method: 'chat_input',
  },
};

/** 채팅 입력 셀 — 학습자가 텍스트 적으면 클리어 (인솔이가 받아 저장) */
export const CHAT_INPUT_CELLS: Set<CellId> = new Set([6, 7, 9]);

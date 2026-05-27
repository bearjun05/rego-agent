import { defineAgent, trigger } from '@rego/runtime-sdk';

/**
 * 본인 에이전트의 명함 (manifest).
 *
 * - name: 변경 금지 (setup 마법사가 본인 이름으로 자동 치환)
 * - description, icon, color는 본인 취향대로
 * - triggers: 어떤 이벤트에 반응할지
 * - tools: 사용할 도구 (자동 동기화되니까 신경 안 써도 됨, 명시하면 권장)
 */
export default defineAgent({
  name: 'yeonjin_joo',
  displayName: '주연진',
  description: '슬랙 멘션을 분류·요약하고, 👀 반응 + 텔레그램 버튼 알림 + 아침 브리핑까지 보내줘요',
  icon: '🧩',
  color: '#2E7A6B',

  triggers: [
    // 본인 이름이 슬랙에서 태그될 때 동작
    trigger.slackMention(),
    // 매일 아침 9시 — 어제 받은 멘션을 모아 텔레그램으로 브리핑 (빙고 8)
    trigger.cron('0 9 * * *'),
  ],

  tools: [
    'telegram.send', // 알림 전송
    'telegram.answer_callback', // 버튼 클릭 ack (빙고 4)
    'telegram.edit_message', // 버튼 누른 결과로 메시지 수정 (빙고 4)
    'slack.reactions_add', // 멘션에 자동 👀 (빙고 3)
    'slack.users_info', // 사용자 ID → 이름 (빙고 5·7)
    'slack.conversations_info', // 채널 ID → 채널명 (빙고 5)
    'slack.reactions_list', // 이모지 BEST 5 분석 (빙고 6)
    'slack.search_messages', // 태그 BEST 3 분석 (빙고 7)
  ],

  // 모델 선택은 선택사항 (런타임 기본값 사용)
});

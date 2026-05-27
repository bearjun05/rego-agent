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
  name: 'hs_han',
  displayName: '한효승',
  description: '슬랙 멘션을 분류·요약하고 답장 후보 3개를 텔레그램 버튼으로 보여줘요',
  icon: '🌿',
  color: '#4A7C45',

  triggers: [
    // 본인 이름이 슬랙에서 태그될 때 동작
    trigger.slackMention(),
    // [빙고 8] 매일 아침 9시(서버 TZ 기준) 어제의 멘션 브리핑
    trigger.cron('0 9 * * *'),
  ],

  tools: [
    'telegram.send',
    'telegram.answer_callback',
    'telegram.edit_message',
    'slack.add_reaction',
    'slack.users_info',
    'slack.conversations_info',
  ],

  // 모델 선택은 선택사항 (런타임 기본값 사용)
});

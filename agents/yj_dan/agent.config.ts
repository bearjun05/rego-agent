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
  name: 'yj_dan',
  displayName: '단예진',
  description: '슬랙 멘션을 분류해서 텔레그램으로 알려줘요',
  icon: '🐳',
  color: '#2A6B8F',

  triggers: [
    // 본인 이름이 슬랙에서 태그될 때 동작
    trigger.slackMention(),
  ],

  tools: [
    'telegram.send',
    'slack.reactions_add',
    'slack.users_info',
    'slack.conversations_info',
    'slack.reply',
  ],

  // 모델 선택은 선택사항 (런타임 기본값 사용)
});

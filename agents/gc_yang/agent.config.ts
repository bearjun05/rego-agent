import { defineAgent, trigger } from '@rego/runtime-sdk';

/**
 * 본인 에이전트의 명함 (manifest).
 *
 * - name: 변경 금지 (slug 고정)
 * - triggers: 어떤 이벤트에 반응할지
 * - tools: 자동 동기화되지만 명시 권장
 */
export default defineAgent({
  name: 'gc_yang',
  displayName: '양기철',
  description: '슬랙 멘션을 교육운영 맥락으로 분류·우선순위 매겨 텔레그램 알림 + 원탁 등록 블록 생성',
  icon: '🌊',
  color: '#1E4D8B',

  triggers: [
    // 본인 이름이 슬랙에서 태그될 때
    trigger.slackMention(),

    // 데일리 다이제스트 (미처리 건 요약).
    // ⚠️ 현재 런타임에는 cron 스케줄러가 없어 이 트리거는 "대기" 상태 —
    //    운영자가 스케줄러를 붙이면 매일 00:00 UTC(=09:00 KST)에 발화.
    //    그 전까지는 대시보드 "수동 실행"(onManual)으로 같은 다이제스트를 받음.
    trigger.cron('0 0 * * *'),

    // 대시보드에서 수동 실행 → 다이제스트 즉시 받기
    trigger.manual(),
  ],

  tools: [
    'telegram.send',
    'telegram.edit_message',
    'telegram.answer_callback',
    'slack.reactions_add',
  ],
});

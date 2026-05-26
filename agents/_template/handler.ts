import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');

/**
 * 본인 에이전트의 실제 동작 코드.
 *
 * 이벤트 종류별 함수:
 *   - onSlackMention: 슬랙에서 본인 이름이 태그될 때 (빙고 1~5,9)
 *   - onSlackMessage: 채널 메시지 (트리거에 명시했을 때)
 *   - onSlackReaction: 이모지 반응 (트리거에 명시했을 때)
 *   - onCron: 스케줄 (빙고 8 — 매일 아침 보고서)
 *   - onTelegramCallback: 텔레그램 버튼 클릭 (빙고 4)
 *   - onManual: 대시보드에서 수동 실행
 *
 * 📖 빙고 셀별 코드 예시는 파일 맨 아래 주석 참고.
 */
export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // 1) 분류 — 빙고 5: prompts/classify.md를 본인 일에 맞게 수정해보세요
    const { category, confidence, reason } = await ctx.llm.classify({
      text: event.text,
      categories: [
        { id: 'question', description: '답변이 필요한 질문' },
        { id: 'request', description: '작업 요청' },
        { id: 'schedule', description: '일정/회의 조율' },
        { id: 'info', description: '정보 공유, 답변 필요 X' },
      ],
      prompt: classifyPrompt,
    });

    // 2) 텔레그램 알림 — 빙고 6: 포맷·이모지를 본인 스타일로!
    const emoji =
      category === 'question'
        ? '❓'
        : category === 'request'
          ? '📝'
          : category === 'schedule'
            ? '📅'
            : '📰';

    const lines = [
      `${emoji} *${category.toUpperCase()}*${confidence >= 0.7 ? '' : ' (애매)'}`,
      ``,
      `*from:* ${event.userName ?? event.user}`, // 빙고 5: event.user(U...) → 이름으로 변환
      `*ch:* #${event.channelName ?? event.channel}`, // 빙고 5: event.channel(C...) → 채널명
      ``,
      event.text.slice(0, 280) + (event.text.length > 280 ? '…' : ''),
    ];
    if (reason) lines.push(``, `_${reason}_`);
    if (event.permalink) lines.push(``, `[원문 보기](${event.permalink})`);

    await ctx.tools['telegram.send']!({
      text: lines.join('\n'),
      parseMode: 'Markdown',
    });

    return { category, confidence };
  },
});

/*
═════════════════════════════════════════════════════════════════════
🎯 빙고 셀별 코드 예시 — 위 onSlackMention 안에 끼워 넣으세요
═════════════════════════════════════════════════════════════════════

🟦 셀 3: 자동 👀 이모지 (멘션 받으면 슬랙 원본에 자동 반응)
─────────────────────────────────────────────────────────────────────
   onSlackMention 맨 위에 추가:

   await ctx.tools['slack.reactions_add']!({
     channel: event.channel,
     ts: event.ts,
     name: 'eyes',  // 또는 'white_check_mark', 'speech_balloon'
   });

🟦 셀 5: 채널명 / 사람 이름 변환 (텔레그램 메시지에 ID 대신 이름 표시)
─────────────────────────────────────────────────────────────────────
   분류 직후, lines 작성 전에:

   const userInfo = await ctx.tools['slack.users_info']!({ user: event.user });
   const channelInfo = await ctx.tools['slack.conversations_info']!({ channel: event.channel });
   const senderName = userInfo.display_name || userInfo.real_name || event.user;
   const channelLabel = channelInfo.name || event.channel;

   그 다음 lines 안의 *from:* / *ch:* 줄을 senderName / channelLabel 로 교체.

🟦 셀 4: 텔레그램 답장 버튼 (멘션 알림에 [확인]/[패스] 버튼 + 콜백 처리)
─────────────────────────────────────────────────────────────────────
   ① telegram.send에 replyMarkup 추가:

   await ctx.tools['telegram.send']!({
     text: lines.join('\n'),
     parseMode: 'Markdown',
     replyMarkup: {
       inline_keyboard: [[
         { text: '✅ 확인', callback_data: `ack:${event.ts}` },
         { text: '⏭ 패스', callback_data: `pass:${event.ts}` },
       ]],
     },
   });

   ② onTelegramCallback 핸들러 추가 (defineHandler 안에):

   async onTelegramCallback(event, ctx) {
     const [action, slackTs] = event.data.split(':');
     await ctx.tools['telegram.edit_message']!({
       chatId: event.chatId,
       messageId: event.messageId,
       text: action === 'ack' ? `✅ 확인 완료 (${slackTs})` : `⏭ 패스됨`,
     });
     return { action };
   },

🟦 셀 8: 아침 보고서 (매일 9시 cron)
─────────────────────────────────────────────────────────────────────
   ① agent.config.ts의 triggers 배열에 추가:

   trigger.cron('0 9 * * *'),   // 매일 오전 9시 (Asia/Seoul)

   ② onCron 핸들러 추가 (defineHandler 안에):

   async onCron(event, ctx) {
     ctx.logger.info('아침 cron 발화', { schedule: event.schedule });
     // (선택) 어제 활동 검색해서 요약
     // const yesterday = await ctx.tools['slack.search_messages']!({
     //   query: 'from:me', count: 20,
     // });
     await ctx.tools['telegram.send']!({
       text: '☀️ 좋은 아침입니다!\n어제 슬랙 활동 요약을 곧 보내드릴게요.',
     });
     return { ok: true };
   },

═════════════════════════════════════════════════════════════════════
💡 막히면 인솔이(대시보드 채팅)에게 물어보세요. 빙고 칸 클릭하면 안내가 떠요.
═════════════════════════════════════════════════════════════════════
*/

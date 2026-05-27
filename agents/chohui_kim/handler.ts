import { defineHandler } from '@rego/runtime-sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const classifyPrompt = await readFile(path.join(here, 'prompts/classify.md'), 'utf8');

// 수신 확인 이모지 — 바꾸려면 여기만 수정 (콜론 없이 slack 이모지 이름)
const REACTION_EMOJI = 'eyes';

export default defineHandler({
  async onSlackMention(event, ctx) {
    ctx.logger.info('슬랙 멘션 받음', { text: event.text.slice(0, 80) });

    // 1) 수신 확인 이모지 즉시 달기
    await ctx.tools['slack.add_reaction']!({
      channel: event.channel,
      timestamp: event.ts,
      emoji: REACTION_EMOJI,
    }).catch((e) => ctx.logger.warn('이모지 달기 실패', { e }));

    // 2) 스레드 컨텍스트 읽기 (스레드 안 멘션일 때)
    let threadContext = '';
    if (event.threadTs && event.threadTs !== event.ts) {
      const { messages } = await ctx.tools['slack.get_thread']!({
        channel: event.channel,
        ts: event.threadTs,
      }).catch(() => ({ messages: [] as { ts: string; text: string; user: string }[] }));

      const prior = messages.filter((m) => m.ts !== event.ts);
      if (prior.length > 0) {
        threadContext = prior
          .slice(-5) // 최근 5개만
          .map((m) => `${m.user}: ${m.text}`)
          .join('\n');
      }
    }

    // 3) 분류 — LLM 실패해도 기본값으로 계속 진행
    let category = 'info';
    let confidence = 0;
    try {
      const classified = await ctx.llm.classify({
        text: event.text,
        categories: [
          { id: 'question', description: '답변이 필요한 질문' },
          { id: 'request', description: '작업 요청' },
          { id: 'schedule', description: '일정/회의 조율' },
          { id: 'info', description: '정보 공유, 답변 필요 X' },
        ],
        prompt: classifyPrompt,
      });
      category = classified.category;
      confidence = classified.confidence;
    } catch (e) {
      ctx.logger.warn('LLM 분류 실패 → 기본값(info) 사용', { e });
    }

    // 4) 한 줄 요약 — LLM 실패 시 원문 앞부분으로 대체
    const summaryPrompt = threadContext
      ? `[스레드 맥락]\n${threadContext}\n\n[멘션 내용]\n${event.text}\n\n위를 바탕으로 핵심만 한 문장(30자 이내)으로 요약해. 존댓말 없이 간결하게.`
      : `다음 슬랙 메시지를 핵심만 담아 한 문장(30자 이내)으로 요약해. 존댓말 없이 간결하게.\n\n${event.text}`;

    let summary = event.text.slice(0, 30).trim();
    try {
      const { text: generated } = await ctx.llm.generate({
        prompt: summaryPrompt,
        maxTokens: 60,
      });
      summary = generated;
    } catch (e) {
      ctx.logger.warn('LLM 요약 실패 → 원문 앞부분 사용', { e });
    }

    // 5) 텔레그램 버튼 메시지
    const categoryEmoji: Record<string, string> = {
      question: '❓',
      request: '📝',
      schedule: '📅',
      info: '📰',
    };
    const categoryLabel: Record<string, string> = {
      question: '질문',
      request: '요청',
      schedule: '일정',
      info: '참고',
    };

    const unsure = confidence < 0.7 ? ' (분류 불확실)' : '';
    const lines = [
      `${categoryEmoji[category] ?? '📌'} [${categoryLabel[category] ?? category}] ${summary.trim()}${unsure}`,
      ``,
      `보낸 사람: ${event.userName ?? event.user}`,
      `채널: #${event.channelName ?? event.channel}`,
    ];
    if (threadContext) lines.push(``, `💬 스레드 맥락 포함하여 요약됨`);
    lines.push(``, `> ${event.text.slice(0, 200)}${event.text.length > 200 ? '…' : ''}`);

    // telegram.send_with_button 실패 시 → telegram.send 로 fallback (알림 누락 방지)
    // 주의: send_with_button은 런타임 DB 추적 대상이 아님(agent-runner는 telegram.send만 기록)
    //       → fallback으로 send를 쓰면 대시보드에도 정상 집계됨
    await ctx.tools['telegram.send_with_button']!({
      text: lines.join('\n'),
      buttons: [
        // callbackData는 텔레그램 64바이트 제한 → permalink 대신 ts만 사용
        { text: '슬랙에서 답장하기 →', callbackData: event.ts },
      ],
    }).catch(async (e) => {
      ctx.logger.warn('텔레그램 버튼 전송 실패 → plain send 재시도', { e });
      await ctx.tools['telegram.send']!({
        text: lines.join('\n'),
      }).catch((e2) => ctx.logger.error('텔레그램 전송 최종 실패', { e2 }));
    });

    return { category, confidence, summary: summary.trim() };
  },
});

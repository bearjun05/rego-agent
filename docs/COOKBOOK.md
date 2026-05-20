# 레시피 모음

자주 하는 패턴들. Claude Code에게 자연어로 부탁할 때 같이 보면 좋아요.

## 1. 멘션 받으면 분류해서 알림

```typescript
// agents/<나>/handler.ts
export default defineHandler({
  async onSlackMention(event, ctx) {
    const { category, confidence } = await ctx.llm.classify({
      text: event.text,
      categories: ['question', 'request', 'schedule', 'info'],
    });
    
    await ctx.tools['telegram.send']({
      text: `[${category}] ${event.userName}: ${event.text}`,
    });
  },
});
```

## 2. 멘션 받으면 답변까지 만들어서 텔레그램으로 (사람이 confirm)

```typescript
export default defineHandler({
  async onSlackMention(event, ctx) {
    const reply = await ctx.llm.generate(
      `다음 슬랙 메시지에 어떻게 답변할까? 짧고 친근하게.\n\n${event.text}`,
      { maxTokens: 200 }
    );
    
    await ctx.tools['telegram.send_with_button']({
      text: `${event.userName}: ${event.text}\n\n💡 제안 답변:\n${reply.text}`,
      buttons: [
        { text: '✅ 보내기', callbackData: `send:${event.channel}:${event.ts}` },
        { text: '✏️ 수정', callbackData: 'edit' },
        { text: '⏭ 패스', callbackData: 'pass' },
      ],
    });
  },
});
```

## 3. 긴 메시지는 자동 요약

```typescript
async onSlackMention(event, ctx) {
  let summary = event.text;
  if (event.text.length > 200) {
    const r = await ctx.llm.generate(
      `다음 메시지를 1-2문장으로 요약: ${event.text}`,
      { maxTokens: 100 }
    );
    summary = r.text;
  }
  
  await ctx.tools['telegram.send']({
    text: `📨 ${event.userName}\n${summary}`,
  });
}
```

## 4. 긴급도 판정 (구조화된 응답)

```typescript
import { z } from '@rego/runtime-sdk';

const Triage = z.object({
  category: z.enum(['question', 'request', 'info']),
  urgency: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  emoji: z.string(),
});

async onSlackMention(event, ctx) {
  const t = await ctx.llm.generateJson(
    `이 슬랙 메시지를 트리아지해줘.\n\n${event.text}`,
    Triage,
  );
  
  const prefix = t.urgency === 'high' ? '🚨' : t.emoji;
  await ctx.tools['telegram.send']({
    text: `${prefix} [${t.category}] ${t.summary}`,
  });
}
```

## 5. 같은 사람의 멘션을 기억 (상태 활용)

```typescript
async onSlackMention(event, ctx) {
  const key = `lastMention:${event.user}`;
  const last = await ctx.state.get<{ ts: number; text: string }>(key);
  
  let contextNote = '';
  if (last && Date.now() - last.ts < 24 * 60 * 60 * 1000) {
    contextNote = `\n(같은 분의 어제 멘션: ${last.text.slice(0, 60)}...)`;
  }
  
  await ctx.tools['telegram.send']({
    text: `📨 ${event.userName}: ${event.text}${contextNote}`,
  });
  
  await ctx.state.set(key, { ts: Date.now(), text: event.text });
}
```

## 6. 스레드 컨텍스트 활용

```typescript
async onSlackMention(event, ctx) {
  let context = '';
  if (event.threadTs && event.threadTs !== event.ts) {
    const thread = await ctx.tools['slack.get_thread']({
      channel: event.channel,
      ts: event.threadTs,
    });
    context = thread.messages
      .slice(0, 5)
      .map((m) => `- ${m.text.slice(0, 100)}`)
      .join('\n');
  }
  
  const summary = await ctx.llm.generate(
    `이 스레드 흐름에서 마지막 멘션이 뭘 묻고 있나?\n\n[스레드]\n${context}\n\n[마지막 멘션]\n${event.text}`,
    { maxTokens: 150 }
  );
  
  await ctx.tools['telegram.send']({
    text: `📌 ${event.userName}: ${summary.text}`,
  });
}
```

## 7. 정해진 시간에 자동 브리핑

```typescript
// agent.config.ts
triggers: [
  trigger.slackMention(),
  trigger.cron('0 9 * * *'),  // 매일 오전 9시
]

// handler.ts
async onCron(event, ctx) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const messages = await ctx.tools['slack.search']({
    query: `from:me after:${yesterday.toISOString().slice(0, 10)}`,
    limit: 20,
  });
  
  const briefing = await ctx.llm.generate(
    `다음 메시지들을 3줄로 요약:\n${messages.results.map((r) => r.text).join('\n---\n')}`,
  );
  
  await ctx.tools['telegram.send']({
    text: `🌅 아침 브리핑\n\n${briefing.text}`,
  });
}
```

## 8. 본인만의 도구 추가

```typescript
// agents/<나>/tools/extract-deadline.ts
import { defineTool, z } from '@rego/runtime-sdk';

export default defineTool({
  id: 'my.extract_deadline',
  name: '마감일 추출',
  description: '텍스트에서 날짜/시간을 추출합니다',
  category: 'utility',
  inputs: z.object({ text: z.string() }),
  outputs: z.object({
    deadline: z.string().nullable(),
    confidence: z.number(),
  }),
  async run({ text }, ctx) {
    // 정규식으로 빠르게 추출
    const m = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (m) {
      const [, month, day] = m;
      return {
        deadline: `2026-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`,
        confidence: 0.9,
      };
    }
    return { deadline: null, confidence: 0 };
  },
});
```

handler에서:
```typescript
const deadline = await ctx.tools['my.extract_deadline']({ text: event.text });
if (deadline.deadline) {
  await ctx.tools['telegram.send']({ text: `⏰ 마감: ${deadline.deadline}` });
}
```

## 9. 다른 사람 도구 빌려 쓰기 (잠수함 기능)

```typescript
// agents/jun/handler.ts
import sumiFormatter from '../sumi/tools/pretty-formatter';

async onSlackMention(event, ctx) {
  const pretty = await sumiFormatter.run({ text: event.text }, {
    agentName: ctx.agentName,
    runId: ctx.runId,
    logger: ctx.logger,
    secret: () => { throw new Error('not allowed'); },
  });
  // ...
}
```

> ⚠ 단, 다른 사람이 그 도구를 지우거나 바꿀 수 있다는 점 유의.

## 10. 채널 모든 메시지 모니터링

```typescript
// agent.config.ts
triggers: [
  trigger.slackMessage({ channel: '운영팀' }),  // 멘션 아니어도 모든 메시지
]

async onSlackMessage(event, ctx) {
  if (event.text.includes('환불')) {
    await ctx.tools['telegram.send']({
      text: `⚠️ 환불 관련 메시지 감지: ${event.text}`,
    });
  }
}
```

## 패턴 모음

- **분류**: `ctx.llm.classify`
- **요약**: `ctx.llm.generate` + 짧은 maxTokens
- **구조화**: `ctx.llm.generateJson` + zod schema
- **기억**: `ctx.state.get/set`
- **검색**: `ctx.tools['slack.search']`
- **버튼**: `ctx.tools['telegram.send_with_button']`

## Anti-pattern (이러지 마세요)

❌ LLM 호출을 루프 안에서 N번 (비용 폭증, 무한루프 자동 정지됨)
❌ `process.env` 직접 접근 (런타임이 막음)
❌ 외부 fetch로 임의 API 호출 (시크릿 누설 위험 — 도구로 감싸세요)
❌ 다른 사람 chat_id로 텔레그램 송신 (자동 차단됨)

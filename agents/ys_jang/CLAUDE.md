# 내 에이전트 폴더 (rego-agent 스터디)

이 폴더는 **나만의 AI 에이전트**가 사는 곳입니다. Claude Code가 이 컨텍스트를 읽고 도와줘요.

## 핵심 규칙 (READ FIRST)

1. **이 폴더 밖은 절대 수정하지 마세요**. CODEOWNERS로 막혀 있어요 (push가 거절됨).
2. **시크릿(API 키, 토큰) 절대 코드에 넣지 마세요**. 환경변수는 운영자가 관리해요.
3. **package.json, pnpm-lock.yaml 같은 공통 파일 수정 X**. 새 라이브러리는 PR로.

## 폴더 구조

```
agents/<내이름>/
├── agent.config.ts    ← 내 에이전트의 명함 (manifest)
├── handler.ts          ← 실제 동작 코드 (메인 진입점)
├── prompts/           ← LLM 프롬프트 (.md 파일)
├── tools/              ← 내가 만든 도구 (선택)
├── fixtures/           ← 내 테스트 시나리오 (선택)
└── CLAUDE.md           ← 이 파일 (Claude Code 컨텍스트)
```

## 어떤 일을 할 수 있나요?

### 1. 슬랙 멘션 처리 (1주차 기본)

```typescript
// agent.config.ts
triggers: [trigger.slackMention()],

// handler.ts
async onSlackMention(event, ctx) {
  // event.text = 받은 메시지
  // event.userName = 보낸 사람
  // event.channelName = 채널
  await ctx.tools['telegram.send']!({ text: `알림: ${event.text}` });
}
```

### 2. 채널의 모든 메시지 받기

```typescript
triggers: [trigger.slackMessage({ channel: '운영팀_잡담' })]
```

### 3. 이모지 반응에 대응

```typescript
triggers: [trigger.slackReaction({ emoji: '👀' })]
```

### 4. 매일 정해진 시간에

```typescript
triggers: [trigger.cron('0 9 * * *')]  // 매일 오전 9시
```

## 사용 가능한 도구

ctx.tools 안에 들어있어요:

- `ctx.tools['slack.reply']({ channel, threadTs, text })` — 슬랙 답장
- `ctx.tools['slack.post_message']({ channel, text })` — 새 메시지
- `ctx.tools['slack.add_reaction']({ channel, timestamp, emoji })` — 이모지
- `ctx.tools['slack.search']({ query, limit })` — 검색
- `ctx.tools['slack.get_thread']({ channel, ts })` — 스레드 조회
- `ctx.tools['telegram.send']({ text, parseMode })` — 내 텔레그램으로
- `ctx.tools['telegram.send_with_button']({ text, buttons })` — 버튼 메시지
- `ctx.tools['llm.generate']({ prompt, ... })` — LLM 텍스트 생성
- `ctx.tools['llm.classify']({ text, categories })` — 분류

또는 더 간단하게 `ctx.llm`:

- `await ctx.llm.generate("프롬프트")` — 자유 생성
- `await ctx.llm.classify({ text, categories })` — 분류
- `await ctx.llm.generateJson("프롬프트", zodSchema)` — JSON 모드

## 새 도구 만들기

`agents/<내이름>/tools/my-tool.ts` 만들면 자동 등록됩니다:

```typescript
import { defineTool, z } from '@rego/runtime-sdk';

export default defineTool({
  id: 'my-tool',  // ctx.tools['my-tool'] 로 호출
  name: '내 도구',
  description: '뭔가 하는 도구',
  category: 'utility',
  inputs: z.object({ text: z.string() }),
  outputs: z.object({ result: z.string() }),
  async run({ text }, ctx) {
    return { result: text.toUpperCase() };
  },
});
```

대시보드 시각화에 자동으로 노드로 나타나요.

## 상태 저장 (영구)

```typescript
await ctx.state.set('lastSeen', { ts: new Date() });
const val = await ctx.state.get('lastSeen');
```

본인 namespace에만 저장됨 (다른 사람 못 봐요).

## 다른 사람 정보 (read-only)

```typescript
const peers = await ctx.peers.list();
const manifest = await ctx.peers.getManifest('sumi');
```

## 프롬프트 작성

`prompts/` 폴더에 `.md` 파일로 두고:

```typescript
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const prompt = await readFile(
  path.join(import.meta.dirname, 'prompts/classify.md'), 'utf8');
```

## 막힐 때

- 클로드코드한테 그냥 자연어로 부탁: "분류 카테고리를 5개로 늘려줘"
- 다른 사람 폴더 (`../sumi/`, `../jun/`) 구경 가능 (read-only)
- 대시보드의 AI 채팅: "이거 어떻게 하면 좋을까?"

## 검증

`git push` → 자동 배포 + 자동 스모크 테스트. 30초 후 대시보드에서 확인.
또는 대시보드의 "스모크 테스트" 버튼으로 즉시 검증.

## 비용

- 실시간 집계됨 (제한은 운영자가 직접 봄)
- 멘션 처리 1건당 ~$0.001 정도 (Haiku 사용 시)
- 욕심부려도 됨, 다만 무한루프는 자동 정지됨 (분당 100 LLM, 200 도구 호출)

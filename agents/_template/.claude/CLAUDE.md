# 내 에이전트 폴더 (rego-agent 스터디) — Claude Code 규칙

이 폴더는 **나만의 AI 에이전트**가 사는 곳입니다. Claude Code가 이 파일을 읽고 규칙을 지킵니다.

## 🚨 반드시 지킬 규칙 (READ FIRST)

1. **이 폴더(`agents/<내slug>/`) 밖은 절대 수정/커밋/푸시 금지.**
   - 커밋은 항상 내 폴더만: `git add agents/<내slug>` → `git commit` → `git push`.
   - `git add .` / `git add -A` 처럼 전체를 담지 말 것. 다른 사람 폴더·공통 코드(`apps/`, `packages/`, `scripts/`, 루트 설정)는 CODEOWNERS가 막아서 push가 거절됩니다.
2. **시크릿(API 키·토큰) 절대 코드에 넣지 말 것.** 환경변수는 운영자가 관리합니다.
3. **공통 파일 수정 금지** (`package.json`, `pnpm-lock.yaml`, workspace 설정 등). 새 라이브러리가 필요하면 운영자에게 요청.
4. **로컬에서 직접 실행할 필요 없음.** 편집하고 push하면 서버가 실행합니다. (테스트는 대시보드의 스모크 버튼)

## 폴더 구조

```
agents/<내slug>/
├── .claude/CLAUDE.md   ← 이 파일 (Claude Code가 자동 로드하는 규칙)
├── agent.config.ts     ← 내 에이전트 명함 (manifest)
├── handler.ts          ← 실제 동작 코드 (메인 진입점)
├── prompts/            ← LLM 프롬프트 (.md)
├── tools/              ← 내가 만든 도구 (선택)
└── fixtures/           ← 내 테스트 시나리오 (선택)
```

## 무엇을 할 수 있나

### 슬랙 멘션 처리 (1주차 기본)
```typescript
// agent.config.ts
triggers: [trigger.slackMention()],

// handler.ts
async onSlackMention(event, ctx) {
  // event.text / event.userName / event.channelName
  await ctx.tools['telegram.send']!({ text: `알림: ${event.text}` });
}
```

### 다른 트리거
- `trigger.slackMessage({ channel: '운영팀_잡담' })` — 채널의 모든 메시지
- `trigger.slackReaction({ emoji: '👀' })` — 이모지 반응
- `trigger.cron('0 9 * * *')` — 매일 정해진 시간

## 사용 가능한 도구 (ctx.tools)

**Slack (학습자 본인 OAuth 토큰으로 자동 동작)**:
- `slack.users_info({ user })` — 사용자 ID → 이름·프로필 (빙고 5)
- `slack.conversations_info({ channel })` — 채널 ID → 이름 (빙고 5)
- `slack.reactions_add({ channel, ts, name })` — 이모지 반응 (빙고 3)
- `slack.reactions_list({ count })` — 본인 이모지 활동 (빙고 6 분석용)
- `slack.search_messages({ query, count })` — 메시지 검색 (빙고 7/8 분석용)
- `slack.conversations_history({ channel, limit })` — 채널 최근 메시지
- `slack.reply` / `slack.post_message` / `slack.add_reaction` / `slack.search` / `slack.get_thread` (옛 호환)

**Telegram**:
- `telegram.send({ text, parseMode?, replyMarkup? })` — 본인 채팅으로 알림 (replyMarkup으로 버튼 가능)
- `telegram.answer_callback({ callbackQueryId, text? })` — 버튼 클릭 ack (빙고 4)
- `telegram.edit_message({ chatId, messageId, text })` — 보낸 메시지 수정 (빙고 4)
- `telegram.send_with_button` (옛 호환)

**LLM**: `ctx.llm.generate` / `ctx.llm.classify` / `ctx.llm.generateJson`

## 핸들러 종류 (이벤트 → 함수)
- `onSlackMention(event, ctx)` — 본인 멘션
- `onSlackMessage(event, ctx)` — 채널 메시지
- `onSlackReaction(event, ctx)` — 이모지 반응
- `onCron(event, ctx)` — cron 스케줄 (빙고 8)
- `onTelegramCallback(event, ctx)` — 텔레그램 버튼 클릭 (빙고 4)
- `onManual(event, ctx)` — 대시보드에서 수동 실행

## 빙고 풀이 흐름 (1주차)
1. **대시보드 채팅(인솔이)에서 셀 클릭** → 미션 안내 카드 뜸
2. **본인 폴더 코드 수정** (`handler.ts` / `agent.config.ts` / `prompts/`) → push
3. **대시보드의 [내 코드 적용하기] 버튼 클릭** → 5초 안에 서버 반영
4. **슬랙에서 본인 멘션** 보내 결과 확인 → 텔레그램 알림 도착
5. 셀 자동 검증 통과 → 다음 셀

## 새 도구 만들기 (`tools/my-tool.ts` → 자동 등록)
```typescript
import { defineTool, z } from '@rego/runtime-sdk';
export default defineTool({
  id: 'my-tool',
  name: '내 도구',
  description: '뭔가 하는 도구',
  category: 'utility',
  inputs: z.object({ text: z.string() }),
  outputs: z.object({ result: z.string() }),
  async run({ text }, ctx) { return { result: text.toUpperCase() }; },
});
```

## 프롬프트 작성 (`prompts/*.md`)
분류 기준·답변 톤을 자연어로 수정. Claude에게 "카테고리 5개로 늘려줘", "답장은 존댓말로" 처럼 부탁하면 파일을 고쳐줍니다.

## 상태 저장 (영구)
```typescript
await ctx.state.set('lastSeen', { ts: new Date() });
const v = await ctx.state.get('lastSeen'); // 본인 namespace에만 저장
```

## 검증 / 배포
- `git push` (내 폴더만) → 약 30초 후 서버 자동 반영 + 스모크 테스트 → 대시보드 **1주차 대시보드(/week1)** 에서 확인.
- 또는 대시보드의 "스모크 테스트" 버튼으로 즉시 검증.

## 막힐 때
- Claude에게 자연어로: "멘션 오면 내용 요약해서 텔레그램으로 보내줘"
- 다른 사람 폴더는 구경만 (read-only). 운영자/대시보드 AI 코치(인솔이)에게 질문.

## 비용 / 안전장치
- 비용은 실시간 집계 (한도는 운영자가 봄). 멘션 1건 ~ $0.001 수준.
- 무한루프는 자동 정지 (분당 100 LLM / 200 도구 호출). 핸들러는 30초 안에 끝나야 함.

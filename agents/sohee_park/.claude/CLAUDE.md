# 내 에이전트 폴더 (rego-agent 스터디) — Claude Code 규칙

이 폴더는 **나만의 AI 에이전트**가 사는 곳입니다. Claude Code가 이 파일을 읽고 규칙을 지킵니다.

## 🚨 반드시 지킬 규칙

1. **이 폴더(`agents/<내slug>/`) 밖은 절대 수정/커밋/푸시 금지.**
   - 커밋은 항상 내 폴더만: `git add agents/<내slug>` → `git commit` → push.
   - `git add .` / `git add -A` 처럼 전체를 담지 말 것. 다른 사람 폴더·공통 코드(`apps/`, `packages/`, `scripts/`, 루트 설정)는 CODEOWNERS가 막아서 push가 거절됩니다.
2. **`learner/<내slug>` 브랜치에 push.** `main`에 push 시도하면 CODEOWNERS가 거절합니다.
3. **시크릿(API 키·토큰) 절대 코드에 넣지 말 것.** 환경변수는 운영자가 관리합니다.
4. **공통 파일 수정 금지** (`package.json`, `pnpm-lock.yaml`, workspace 설정 등). 새 라이브러리가 필요하면 운영자에게 요청.
5. **로컬에서 직접 실행할 필요 없음.** 편집 + push 하면 서버가 자동 반영합니다.

## 📤 코드 반영 흐름 (자동)

```
[로컬]  편집 → git add agents/<내slug>
          → git commit -m "..."
          → git push origin learner/<내slug>
                  ↓
[GitHub] webhook
                  ↓
[서버]   30~60초 내 자동 반영
                  ↓
[대시보드]  인솔이 채팅에 ⚡ "코드 적용 중…" shimmer
            → ✅ "코드 적용 완료! 테스트해볼까요?"
            → 스모크 카드 자동 표시 (예시 메시지 클릭 또는 직접 만들기)
```

**처음 한 번 — 브랜치 셋업** (clone 직후):
```bash
git fetch origin
git checkout learner/<내slug>   # 슬랙 OAuth 후 서버가 자동 생성한 브랜치
# 또는 브랜치가 아직 없으면:
# git checkout -b learner/<내slug>
```

이후는 그 브랜치에서 commit + push만 반복.

## 폴더 구조

```
agents/<내slug>/
├── .claude/CLAUDE.md   ← 이 파일 (Claude Code 자동 로드)
├── agent.config.ts     ← 내 에이전트 명함 (manifest)
├── handler.ts          ← 실제 동작 코드
├── prompts/            ← LLM 프롬프트 (.md)
├── tools/              ← 내가 만든 도구 (선택)
└── fixtures/           ← 내 테스트 시나리오 (선택)
```

## 무엇을 만들 수 있나

### 슬랙 멘션 처리 (기본)
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
- `trigger.cron('0 9 * * *')` — 매일 정해진 시간 (빙고 8)

## 사용 가능한 도구 (`ctx.tools`)

**Slack (학습자 본인 OAuth 토큰으로 자동 동작)**:
- `slack.users_info({ user })` — 사용자 ID → 이름·프로필 (빙고 5)
- `slack.conversations_info({ channel })` — 채널 ID → 이름 (빙고 5)
- `slack.reactions_add({ channel, ts, name })` — 이모지 반응 (빙고 3)
- `slack.reactions_list({ count })` — 본인 이모지 활동 (빙고 6 분석용)
- `slack.search_messages({ query, count })` — 메시지 검색 (빙고 7 분석용)
- `slack.conversations_history({ channel, limit })` — 채널 최근 메시지
- `slack.reply` / `slack.post_message` / `slack.add_reaction` / `slack.search` / `slack.get_thread` (옛 호환)

**Telegram**:
- `telegram.send({ text, parseMode?, replyMarkup? })` — 본인 채팅 알림 (replyMarkup으로 버튼)
- `telegram.answer_callback({ callbackQueryId, text? })` — 버튼 클릭 ack (빙고 4)
- `telegram.edit_message({ chatId, messageId, text })` — 메시지 수정 (빙고 4)
- `telegram.send_with_button` (옛 호환)

**LLM**: `ctx.llm.generate` / `ctx.llm.classify` / `ctx.llm.generateJson`

## 핸들러 종류

- `onSlackMention(event, ctx)` — 본인 멘션
- `onSlackMessage(event, ctx)` — 채널 메시지
- `onSlackReaction(event, ctx)` — 이모지 반응
- `onCron(event, ctx)` — cron 스케줄 (빙고 8)
- `onTelegramCallback(event, ctx)` — 텔레그램 버튼 클릭 (빙고 4)
- `onManual(event, ctx)` — 대시보드 수동 실행 / 스모크 테스트

## 빙고 풀이 흐름 (2주차)

대시보드(https://rego.jotto.in)에서 인솔이(🐱)가 안내합니다.

1. **빙고 한 칸 클릭** → 미션 안내 + 코드 스니펫
2. **본인 폴더에서 코드 수정** (`handler.ts` / `agent.config.ts` / `prompts/`)
3. **`git push origin learner/<내slug>`**
4. **30~60초 후 인솔이 채팅창에 자동 알림**: ⚡ shimmer → ✅ 완료 → 스모크 카드
5. **스모크 카드의 예시 메시지 클릭** 또는 "직접 만들기"로 테스트 → 텔레그램 결과 확인
6. 자동 검증 통과 → 다음 칸

**채팅 입력 빙고 (6/7/9)**: 코드 수정 없이 대시보드 인솔이 채팅창에 답변 적기 (3자 이상).

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

## 막힐 때

- Claude에게 자연어로: "멘션 오면 내용 요약해서 텔레그램으로 보내줘"
- 대시보드 인솔이(🐱)에게 질문 — 본인 진행 상황 보고 다음 한 줄 안내해줍니다.
- 다른 사람 폴더는 구경만 (read-only).

## 비용 / 안전장치

- 비용은 실시간 집계 (한도는 운영자가 봄). 멘션 1건 ~ $0.001 수준.
- 무한루프는 자동 정지 (분당 100 LLM / 200 도구 호출). 핸들러는 30초 안에 끝나야 함.

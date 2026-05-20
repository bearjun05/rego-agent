# 학습자 가이드 — 1주차 시작

> 환영합니다! 이 문서를 30분만 따라하면 본인 슬랙 멘션이 텔레그램으로 알림 오는 AI 비서가 살아 움직여요.

## 0. 준비물 (5분, 한 번만)

### Node.js + pnpm 설치

**Mac**:
```bash
brew install node pnpm
```

**Windows**:
1. [nodejs.org](https://nodejs.org) 에서 LTS 버전 설치
2. PowerShell에서:
```powershell
npm install -g pnpm
```

확인:
```bash
node --version    # v20 이상
pnpm --version    # 10 이상
```

### Claude Code 설치 (이미 있을 가능성 큼)

[claude.com/code](https://claude.com/code) 에서 다운로드.

## 1. 레포 받기 (1분)

```bash
git clone https://github.com/bearjun05/rego-agent.git
cd rego-agent
pnpm install
```

`pnpm install`이 의존성을 다 받아줘요 (1-3분 소요).

## 2. 셋업 마법사 (3분)

```bash
pnpm run setup
```

질문에 답해주세요:

```
[1/4] 본인 정보를 입력하세요.

본인 회사 이메일 닉네임 (영문, 예: uj.choe): uj.choe
표시 이름 (한글 가능, 기본: uj.choe): 최우진
GitHub 핸들 (CODEOWNERS용, 예: bearjun05): bearjun05
프로필 이모지 (기본: 🤖): 🧠
테마 색깔 (hex, 기본: #000000): #C5532E
```

→ `agents/uj.choe/` 폴더가 만들어져요.

## 3. 텔레그램 연결 (2분)

마법사가 안내해줘요:

> 텔레그램에서 @rego_agent_bot 를 검색하고 다음 메시지를 보내세요:
> `/start uj.choe`

봇이 답장하고 자동으로 연결돼요.

```
✅ 등록 완료!
이름: uj.choe
이제 셋업 마법사로 돌아가세요. 잠시 후 자동으로 진행돼요.
```

마법사가 자동으로 감지하면:
```
✅ 텔레그램 연결 완료!
```

## 4. 첫 push (2분)

```bash
git add agents/uj.choe
git commit -m "feat: uj.choe 시작"
git push
```

→ Railway가 자동 배포해요 (30초 정도).
→ 텔레그램으로 "환영! 첫 에이전트 동작 중" 알림이 와요.

## 5. 동작 확인 (1분)

대시보드 열기:
```
https://<운영자가-알려준-도메인>/
```

- 본인 카드가 보이면 OK!
- "스모크" 탭에서 가상 멘션을 던져볼 수 있어요
- 슬랙에서 본인 이름(`@uj.choe`) 태그하면 텔레그램으로 알림이 와요

## 6. 본인 에이전트 깎기 (메인 학습)

```bash
cd agents/uj.choe
claude
```

Claude Code가 본인 폴더의 `CLAUDE.md`를 읽고 컨텍스트 잡아요.

이제 자연어로 부탁:

- "분류 카테고리를 5개로 늘리고 각각 다른 이모지 붙여줘"
- "텔레그램 알림 형식을 좀 더 예쁘게 만들어줘"
- "긴 메시지는 자동 요약해서 보내줘"
- "환불 관련 메시지는 더 빠르게 답할 수 있게 priority 표시 추가해줘"

## 7. 변경 검증

### 방법 1: 대시보드 스모크 테스트 (가장 빠름)

1. 대시보드 `/smoke` 페이지
2. "테스트할 에이전트"에 본인 선택
3. fixture 카드 → "▶ 실행" 또는
4. 즉시 멘션 시뮬레이션: 직접 텍스트 입력

### 방법 2: 진짜 슬랙 멘션

회사 슬랙에서 본인을 태그하는 메시지 보내면 실제로 동작해요.

## 8. push로 배포

```bash
git add agents/uj.choe
git commit -m "feat: 분류 카테고리 확장"
git push
```

→ 30초 내 Railway 자동 배포 → 변경된 동작이 즉시 반영.

## 도구 카탈로그

본인 handler.ts에서 사용 가능:

```typescript
async onSlackMention(event, ctx) {
  // 슬랙
  await ctx.tools['slack.reply']({ channel, threadTs, text });
  await ctx.tools['slack.post_message']({ channel, text });
  await ctx.tools['slack.add_reaction']({ channel, timestamp, emoji });
  await ctx.tools['slack.search']({ query, limit: 20 });
  await ctx.tools['slack.get_thread']({ channel, ts });
  
  // 텔레그램
  await ctx.tools['telegram.send']({ text, parseMode: 'Markdown' });
  await ctx.tools['telegram.send_with_button']({ text, buttons });
  
  // LLM (간편 API)
  await ctx.llm.generate("프롬프트");
  await ctx.llm.classify({ text, categories: ['question', 'request'] });
  await ctx.llm.generateJson("프롬프트", zodSchema);
  
  // 상태 (영구, 본인 namespace만)
  await ctx.state.set('lastSeen', { ts: Date.now() });
  const val = await ctx.state.get('lastSeen');
  
  // 다른 사람 정보 (read-only)
  const peers = await ctx.peers.list();
  const manifest = await ctx.peers.getManifest('sumi');
}
```

## 트리거 종류

`agent.config.ts`의 `triggers` 배열에 추가:

```typescript
import { trigger } from '@rego/runtime-sdk';

triggers: [
  trigger.slackMention(),                          // 본인이 태그될 때
  trigger.slackMention({ channel: '운영팀' }),     // 특정 채널만
  trigger.slackMessage({ channel: '제품실' }),     // 채널 모든 메시지
  trigger.slackReaction({ emoji: '👀' }),         // 이모지 반응
  trigger.cron('0 9 * * *'),                       // 매일 9시
]
```

## 자주 묻는 질문

### Q. 다른 사람 코드를 봐도 돼요?

봐도 돼요. read-only로. 다만 수정은 불가 (CODEOWNERS).

```bash
cd agents/sumi   # 다른 사람 폴더
cat handler.ts   # 봐도 OK
```

### Q. 새 라이브러리 쓰고 싶어요

`package.json` 수정은 PR 필요해요. 운영자가 보안 자동 검사 후 머지.

다만 본인 폴더 안에서는 표준 Node.js + 제공된 도구로 거의 다 해결 가능.

### Q. 실수로 잘못 push 했어요

- 텔레그램으로 이상한 게 가더라도 자동 정지 메커니즘이 있어요 (분당 100 호출 초과 시).
- 운영자가 대시보드에서 즉시 일시정지 가능.
- 다시 push해서 고치면 됨.

### Q. 비용 걱정돼요

- 비용은 운영자가 OpenRouter에 카드 등록해서 자동 결제.
- 1주차 기준 1인당 하루 평균 ~$0.1.
- 무한루프는 자동 차단되니까 마음 편히 실험.

### Q. 막혔어요

1. 대시보드 우상단 💬 AI 채팅에 물어보기
2. 운영자(준)한테 슬랙 DM
3. 다른 사람 폴더 보기 (영감)

## 다음 (2주차+ 예고)

- 2주차: Calendar 도구 추가 (일정 자동 비서)
- 3주차+: 두 에이전트를 도구로 활용하는 오케스트레이터

행운을 빌어요! 🚀

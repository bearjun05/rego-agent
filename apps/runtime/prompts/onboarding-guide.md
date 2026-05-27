# rego-agent 온보딩 가이드 (AI 코치 참고 문서)

> 이 문서는 대시보드의 **AI 코치(인솔이 🐱)**가 비개발자 학습자를 1:1로 안내할 때 참고하는 지식 베이스다.
> 코치는 이 흐름을 **순서대로**, **한 번에 한 단계씩**, 사용자의 상황(OS/설치 여부)에 맞춰 안내한다.

> ⚠️ 주차 표기 주의: 이 가이드 안에서 언급되는 "1주차/2주차/N주차" 표현은 커리큘럼 단계 설명일 뿐이고,
> **현재 진행 중인 주차는 시스템 프롬프트의 `[현재 주차]` 블록만 참고**할 것. 학습자가 "오늘 몇 주차?" 물으면 그 값을 답해.

## 스터디 컨셉 (첫 인사 때 자연스럽게 전달)

**"에이전트는 레고다."** 8주 동안 블록을 하나씩 끼우듯 나만의 AI 비서를 만든다.
- **시작 단계**: 슬랙 API를 연결해 멘션이 오면 나에게 **텔레그램 메시지로 전달**하는 것부터.
- **이후**: 내 AI 에이전트에 **도구를 하나씩 붙이고**, **프롬프트도 직접 작성**하며 비서를 키워간다.

> 학습자는 로컬에서 코드를 돌릴 필요가 없다. **편집 + push만** 하면 서버가 실행한다. (pnpm/로컬 실행 불필요)

---

## 핵심 정보 (자주 쓰는 값)

- 저장소: `https://github.com/bearjun05/rego-agent.git` (private — 협업자 초대 필요)
- 텔레그램 봇: **@rego_agent_bot** (이름: Rego)
- 내 작업 폴더: `agents/<내slug>/` (예: 최웅준 → `uj_choe`)
  - slug 규칙: 회사 이메일 앞부분의 `.` 을 `_` 로 바꾼 것. `uj.choe@…` → `uj_choe`
- 대시보드: https://rego.jotto.in

---

## 전체 흐름 (6단계)

**대시보드(브라우저)에서 먼저**:
1. **텔레그램 봇 연결** (대시보드 인솔이 안내 따라 `@rego_agent_bot`에 `/start <내slug>`)
2. **슬랙 OAuth** (인솔이 채팅의 "Slack 인증하기" 카드)
   → 끝나면 서버가 자동으로 `learner/<내slug>` 브랜치 만들어둠

**본인 컴퓨터에서**:
3. **GitHub에서 코드 받기** (clone)
4. **본인 브랜치로 이동** (`git checkout learner/<내slug>`)
5. **내 이름 폴더로 이동 + Claude Code 열기** (`cd agents/<내slug>` → `claude`)
6. **편집 + push → 자동 반영** — handler.ts / prompts 깎으며 비서 만들기

> 텔레그램·슬랙은 **브라우저에서**, 코드 받기·수정은 **본인 컴퓨터에서**. 인솔이가 한 단계씩 안내해줍니다.

---

## 진행 원칙 (코치가 지킬 것)

- 시작할 때 **"무슨 컴퓨터 쓰세요? (Mac / Windows)"** 를 먼저 물어본다. 명령어가 다르기 때문.
- 한 번에 한 단계만. 사용자가 "됐어요/완료"라고 하면 다음 단계로.
- 명령어는 그대로 복사할 수 있게 코드블록으로 준다.
- 안 되면 "어떤 화면/에러가 떴는지" 물어보고 트러블슈팅으로 안내.
- 메시지는 짧게(1~2문장), 사람이 채팅하듯.

---

## 0단계 — OS 확인

> "먼저 무슨 컴퓨터 쓰세요? 맥(Mac)이에요, 윈도우(Windows)예요?"
이후 모든 명령어를 해당 OS에 맞춰 안내한다.

---

## 3단계 — GitHub에서 코드 받기 (clone)

> ⚠️ 이 단계는 1·2단계(텔레그램·슬랙)를 대시보드에서 끝낸 후 진행.
> 슬랙 OAuth가 끝나야 서버가 본인 브랜치(`learner/<내slug>`)를 자동 생성합니다.

**git 설치 확인**
- Mac: 터미널(`Terminal` 앱)에서 `git --version`. 없으면 안내문 따라 설치 팝업.
- Windows: `git --version` (PowerShell). 없으면 https://git-scm.com/download/win 설치.

**clone (공통)**
```
git clone https://github.com/bearjun05/rego-agent.git
cd rego-agent
```
- private 저장소라 로그인/권한 필요. "Repository not found" 가 뜨면 → 운영자(준)에게 GitHub 협업자 초대 요청.

## 4단계 — 본인 브랜치로 이동

슬랙 OAuth가 끝나면 서버가 `learner/<내slug>` 브랜치를 GitHub에 자동 생성했어요. 그 브랜치로 이동:

```
git fetch origin
git checkout learner/<내slug>     # 예: git checkout learner/uj_choe
```

브랜치가 아직 없으면 (OAuth 안 끝남) 직접 만들기도 가능:
```
git checkout -b learner/<내slug>
```

**왜 본인 브랜치인가**:
- `main`은 운영자만 push 가능 (CODEOWNERS). 학습자가 main에 push 시도하면 거절됩니다.
- 본인 브랜치 push만 GitHub webhook으로 서버에 자동 반영됩니다.

---

## 5단계 — 내 이름 폴더로 이동

먼저 내 slug 확인 (이름 → slug). 모르면 코치가 매핑해준다.

**Mac (터미널)**
```
cd agents/<내slug>      # 예: cd agents/uj_choe
ls                       # 폴더 내용 보이면 성공
```
폴더 이름이 헷갈리면 찾기:
```
ls agents | grep <이름일부>      # 예: ls agents | grep choe
```

**Windows (PowerShell)**
```
cd agents\<내slug>      # 예: cd agents\uj_choe
dir                      # 또는 Get-ChildItem
```
폴더 찾기:
```
Get-ChildItem agents -Directory | Select-String <이름일부>
```

> 폴더 안에는 `agent.config.ts`, `handler.ts`, `prompts/`, `CLAUDE.md` 가 있어야 정상.

---

## 6단계 — 그 폴더에서 Claude Code 열기

**설치 확인**
```
claude --version
```
**설치 안 됐을 때**
```
npm install -g @anthropic-ai/claude-code
```
- npm(노드)이 없으면: Mac은 https://nodejs.org LTS 설치, Windows도 동일.

**열기 (내 폴더 안에서)**
```
claude
```
- Claude Code가 뜨고 내 폴더의 `CLAUDE.md`를 읽으면 성공. 여기서부터는 자연어로 부탁하면 된다.

---

## 1단계 — Telegram 봇 연결 (가장 먼저!)

> 대시보드에서 인솔이가 이 단계를 가장 먼저 안내합니다.

1. **Telegram 설치**: 앱 없으면 https://telegram.org (Mac/Windows/모바일 아무거나).
2. Telegram에서 **@rego_agent_bot** 검색 → 대화 열기.
3. 다음을 그대로 보낸다 (내 slug로):
   ```
   /start <내slug>      # 예: /start uj_choe
   ```
4. 봇이 "연결됐어요" 류의 응답을 보내면 성공. 대시보드에 돌아와 인솔이에게 알리거나 새로고침하면 ✓로 바뀜.

> 연결이 안 되면: slug 오타 확인 / 봇이 맞는지(@rego_agent_bot) 확인 / 잠시 후 재시도.

## 2단계 — 슬랙 OAuth (대시보드에서)

대시보드 인솔이 채팅에 **"Slack 인증하기"** 카드가 뜨면 클릭 → 새 탭에서 본인 슬랙 워크스페이스 인증.

- 인증 완료 후 자동으로 빙고 1번이 채워지고, 서버가 `learner/<내slug>` 브랜치를 GitHub에 자동 생성합니다.
- 본인 슬랙 ID와 등록된 자리가 다르면 거절됩니다 (다른 사람 자리로 인증 시도 방지).

---

## 7단계 — 개발 시작: 내 비서 깎기

기본 목표는 **"슬랙에서 멘션을 받으면 텔레그램으로 알림"**. 여기서부터 자유롭게 확장한다.

**무엇을 만들 수 있나 (예시로 영감 주기)**
- 멘션이 오면 **제안 답장**을 만들어준다 ("이렇게 답하면 어때요?")
- 멘션 내용을 **한 줄 요약**해서 보내준다
- 멘션을 **분류**한다 (질문/요청/일정/참고) + 우선순위
- 텔레그램 **버튼**으로 처리 (승인/수정/패스)
- 특정 키워드(예: "환불")만 골라서 알림

**어디를 고치나**
- **프롬프트**: `prompts/classify.md` 같은 `.md` 파일. 분류 기준·답변 톤을 자연어로 수정.
  - 예) "카테고리를 5개로 늘려줘", "답장은 존댓말로" → Claude에게 그대로 부탁하면 파일을 고쳐준다.
- **동작(스크립트)**: `handler.ts`. 이벤트를 받아 무엇을 할지 결정하는 코드.
  - 예) `onSlackMention(event, ctx)` 안에서 `ctx.llm.generate(...)` 로 요약 후 `ctx.tools['telegram.send']({...})`.
- **명함**: `agent.config.ts`. 트리거(`trigger.slackMention()`)·도구·아이콘 등.

**반영하기 (자동)**
```
git add agents/<내slug>
git commit -m "내 에이전트 수정"
git push origin learner/<내slug>
```
- **자동 동기화**: 본인 브랜치(`learner/<내slug>`)에 push만 하면 GitHub webhook이 우리 서버로 알려줘서
  **30~60초 안에 자동으로 반영**돼. "내 코드 적용" 버튼 누를 필요 없음.
- 인솔이 채팅에 SSE로 `agent.reloaded` 이벤트가 와서 "⚡ 코드 적용 완료" 알림이 자동으로 뜸.
- 만약 자동이 안 됐으면(webhook 실패 등) `ReloadButton` 카드로 수동 적용 가능.

**Claude에게 부탁하는 예시 문구**
- "멘션이 오면 내용 요약해서 텔레그램으로 보내게 해줘"
- "분류 결과에 따라 버튼을 다르게 만들어줘"
- "답장 후보를 3개 만들어서 버튼으로 고르게 해줘"

---

## 트러블슈팅 (자주 막히는 곳)

- `command not found: git/claude/npm` → 해당 도구 미설치. 위 설치 단계로.
- `Repository not found` (clone) → private 권한. 운영자에게 협업자 초대 요청.
- 폴더가 안 보임 → `agents/` 안에서 `ls`(Mac)/`dir`(Win)로 내 slug 철자 확인.
- 텔레그램 무응답 → `/start <slug>` slug 오타, 봇(@rego_agent_bot) 확인.
- push 거절 → 내 폴더(`agents/<내slug>/`) 밖을 건드리면 CODEOWNERS가 막는다. 내 폴더 안에서만 작업.
- LLM 에러 → 운영자에게 알림 (OpenRouter 키/한도).

---

# 프로젝트 레퍼런스 (코치 Q&A용 — 사용자가 물으면 여기서 찾아 답한다)

## 한 줄 정의
스파르타 AI 에이전트 스터디 플랫폼. 15명의 비개발자가 본인 슬랙 멘션을 처리하는 AI 비서를 8주간 직접 만든다.

## 핵심 멘탈 모델 (에이전트 = 레고)
에이전트 = **트리거(언제) + 도구(무엇을) + 프롬프트/규칙(어떻게) + 상태(기억)**.
각 사용자는 본인 폴더 `agents/<slug>/` 안에서 이 4축을 자유롭게 조립한다. 런타임은 슬랙/텔레그램/LLM만 제공하고 정책을 강제하지 않는다.

## 도메인 용어
- **agent**: 사용자가 만든 AI 비서 (폴더 1개 = 에이전트 1개)
- **manifest** (`agent.config.ts`): 에이전트 명함 — 이름·트리거·도구·아이콘
- **handler** (`handler.ts`): 실제 동작 코드 (이벤트 받아 처리하는 메인 진입점)
- **trigger**: 발화 조건 — `slack.mention`, `slack.message`, `slack.reaction`, `cron` 등
- **tool**: 에이전트가 쓰는 함수 — `slack.reply`, `telegram.send`, `llm.generate`, `llm.classify` 등
- **run**: 핸들러 한 번의 실행 단위
- **fixture / smoke**: 가짜 슬랙 멘션으로 본인 에이전트를 검증하는 테스트

## 폴더 구조 (모노레포)
```
rego-agent/
├── apps/runtime/        ← Hono API 서버 (webhook 수신 + AgentRunner). 서버에서 실행됨
├── apps/dashboard/      ← Next.js 대시보드 (rego.jotto.in)
├── packages/runtime-sdk/← defineAgent / defineTool / defineTrigger
├── packages/tools/      ← Slack / Telegram / LLM 공통 도구
├── packages/db/         ← Drizzle ORM (Postgres) 스키마
├── agents/_template/    ← 새 폴더의 시작 템플릿
└── agents/<slug>/       ← 각자 폴더 (본인만 수정 가능)
```

## 내 폴더 안에서 쓰는 것들
- `agent.config.ts`: `triggers: [trigger.slackMention()]`, `tools: ['telegram.send']` 등
- `handler.ts`: `onSlackMention(event, ctx)` 안에서 `ctx.tools['telegram.send']({ text })` 또는 `ctx.llm.generate(...)`
- `prompts/*.md`: LLM 프롬프트 (분류 기준·답변 톤 등, 자연어로 수정)
- `tools/*.ts`: 내가 만든 커스텀 도구 (`defineTool`) — 자동 등록
- 상태 저장: `ctx.state.set/get` (본인 namespace, 다른 사람 못 봄)
- 다른 사람 정보: `ctx.peers.list()`, `ctx.peers.getManifest(slug)` (read-only)

## 사용 가능한 도구 (ctx.tools)
- `slack.reply` / `slack.post_message` / `slack.add_reaction` / `slack.search` / `slack.get_thread`
- `telegram.send` / `telegram.send_with_button`
- `llm.generate` / `llm.classify`  (또는 간단히 `ctx.llm.generate`, `ctx.llm.classify`, `ctx.llm.generateJson`)

## 기술 스택 / 운영
- 호스팅: **이 서버 자체 호스팅** (Railway 아님). Postgres(docker) + runtime(3001) + dashboard(3030) + Caddy(rego.jotto.in)
- LLM: OpenRouter (분류=Haiku급, 답변/채팅=Sonnet급 등 모델 env로 지정)
- DB: Postgres + Drizzle ORM (영구 로그)
- 배포: 본인 폴더 수정 → `git push origin learner/<slug>` → GitHub webhook → 서버가 그 학습자 폴더만 동기화 + reload + AI분석 → 대시보드/텔레그램 반영 (30~60초)
- 안전장치: 분당 200 도구 / 100 LLM 초과 시 자동 정지(runaway) + audit. 핸들러 timeout 30초.
- 비용: 실시간 집계만 (한도는 운영자가 봄). 멘션 1건 ~ $0.001 수준(저렴한 모델 기준).

## 8주 커리큘럼 (에이전트는 레고)
- **1주차**: 슬랙 멘션 → 텔레그램 알림 (분류 포함)
- **2주차**: Calendar 등 도구 하나 더 붙이기
- **3주차+**: 여러 도구를 조합한 오케스트레이터, 프롬프트 고도화
- 매주 블록을 하나씩 끼우며 나만의 비서를 키운다.

## 반드시 지키는 규칙 (학습자)
1. **내 폴더(`agents/<내slug>/`) 안에서만** 수정·커밋·푸시. 밖은 CODEOWNERS가 막는다.
2. 시크릿(API 키/토큰) 코드에 절대 금지. 환경변수는 운영자가 관리.
3. 공통 파일(package.json, pnpm-lock 등) 수정 금지 — 필요하면 운영자에게.
4. 로컬에서 직접 실행할 필요 없음. 편집 + push만 하면 서버가 실행.

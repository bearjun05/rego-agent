# rego-agent — 프로젝트 컨텍스트 (Claude Code용)

## 한 줄 정의

스파르타 AI 에이전트 스터디 플랫폼. 15명의 비개발자가 본인 슬랙 멘션을 처리하는 AI 비서를 8주간 깎는다.

## 핵심 메탈 모델

에이전트 = **트리거(언제) + 도구(무엇을) + 프롬프트/규칙(어떻게) + 상태(기억)**.

각 사용자는 본인 폴더 `agents/<자기이름>/` 안에서 이 4축을 자유롭게 정의한다.
런타임(Railway)은 슬랙/텔레그램/LLM API만 제공하고, 정책은 일절 강제하지 않는다.

## 폴더 구조 (절대 잊지 말 것)

```
rego-agent/                  ← 모노레포 루트
├── apps/runtime/            ← Hono 기반 API 서버 (webhook + AgentRunner)
├── apps/dashboard/          ← Next.js 14 대시보드
├── packages/runtime-sdk/    ← defineAgent/defineTool/defineTrigger
├── packages/tools/          ← Slack/Telegram/LLM 공통 도구
├── packages/db/             ← Drizzle ORM 스키마
├── agents/_template/        ← 시작 템플릿
├── agents/<사용자>/          ← 각자 폴더 (본인만 수정 가능)
├── fixtures/                ← 공통 스모크 시나리오
├── scripts/                 ← setup, manifest-sync, secret-scan
└── .github/                 ← CODEOWNERS + CI
```

## 핵심 결정사항

(자세한 건 `.claude/plans/FINAL-DECISIONS.md`)

- **Repo**: private GitHub `bearjun05/rego-agent`
- **호스팅**: Railway 단일 서비스
- **LLM**: OpenRouter (Haiku 4.5 분류, Sonnet 4.5 답변/채팅)
- **DB**: Postgres (Drizzle ORM, 영구 로그)
- **Manifest sync**: 자동 (코드에서 사용한 도구 자동 추가)
- **비용 한도**: 없음, 실시간 집계만
- **무한루프**: 분당 200 호출/100 LLM → 자동 정지 + audit
- **권한**: CODEOWNERS로 본인 폴더만 수정. 공통은 PR
- **시각화**: React Flow 기반 (Phase 2)
- **AI 채팅**: 단순 Q&A (프로젝트 데이터 기반)

## 작업 시 규칙

### 절대 하지 말 것

- 시크릿(API 키, 토큰)을 코드에 박지 말 것. 환경변수만 사용
- `agents/_template/`은 시작점 — 깨지 않게 신중히
- DB 스키마 변경은 마이그레이션 동반
- 사용자(학습자)의 본인 폴더(`agents/<name>/`) 안에 있는 코드를 임의로 수정하지 말 것

### 권장

- 도구는 `defineTool` 패턴 따르기 (메타데이터 + run 함수)
- 새 도구는 `packages/tools/` 또는 `agents/<자기>/tools/`
- 에러는 throw — AgentRunner가 캐치해서 DB 기록
- 길게 도는 작업은 timeout 30초 안에 끝나야 함

## 개발 명령어

```bash
pnpm install              # 의존성
pnpm dev                  # runtime + dashboard 동시
pnpm build                # 전체 빌드
pnpm test                 # 모든 패키지 테스트
pnpm typecheck            # 타입 검사
pnpm db:push              # Postgres 스키마 push
pnpm db:studio            # Drizzle Studio
pnpm setup                # 학습자 셋업 마법사
pnpm seed                 # 데모 데이터 시드
pnpm check:secrets        # 시크릿 누설 검사 (pre-commit)
pnpm check:codeowners     # CODEOWNERS 위반 검사
pnpm manifest:sync        # 모든 agent manifest 자동 동기화
```

## 환경변수 (`.env.example` 참고)

```
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
TELEGRAM_BOT_TOKEN=
OPENROUTER_API_KEY=
DATABASE_URL=
GITHUB_WEBHOOK_SECRET=
```

자세한 건 `.env.example`.

## 도메인 용어

- **agent**: 사용자가 만든 AI 비서 (폴더 = 1 agent)
- **manifest** (`agent.config.ts`): 에이전트 명함 (이름, 트리거, 도구)
- **handler** (`handler.ts`): 실제 동작 코드 (이벤트 받아 처리)
- **trigger**: 에이전트 발화 조건 (slack.mention, cron, etc.)
- **tool**: 에이전트가 쓸 수 있는 함수 (slack.reply, telegram.send 등)
- **run**: 한 번의 핸들러 실행 단위
- **fixture**: 스모크 테스트용 가짜 데이터 (가짜 슬랙 멘션)
- **smoke**: fixture로 본인 에이전트 검증

## 사용자 학습 흐름 (8주)

- 1주차: Slack 멘션 → Telegram 알림 (분류)
- 2주차: Calendar 도구 추가
- 3주차+: 둘을 조합한 오케스트레이터

## 운영자가 자주 할 일

- 에이전트 일시정지 (대시보드 /admin)
- audit log 검토
- fixture 큐레이션 추가
- 사람들 막혔을 때 코칭 (대시보드 AI 채팅으로 진행 파악)

## 트러블슈팅

- runtime이 안 뜸 → `.env` 확인, `DATABASE_URL` 확인
- agent 로드 안 됨 → `agents/<name>/agent.config.ts`와 `handler.ts` 둘 다 있어야 함
- LLM 에러 → `OPENROUTER_API_KEY` 확인, 한도 확인
- Slack webhook 404 → Railway 도메인 + Event Subscription Request URL 매칭
- Telegram /start 안 됨 → 봇 토큰 확인, webhook URL 등록 확인

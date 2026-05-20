# 🌅 일어났으면 이걸 먼저 봐

> 자는 동안 `rego-agent` v0.1.0을 다 만들었어. 서버까지 띄워뒀어서 바로 시연 가능.

## 1. 지금 동작 중인 것

| 컴포넌트 | 상태 | 주소 |
|---|---|---|
| Postgres (Docker) | ✅ 돌고 있음 | `localhost:5436` (container: `rego-agent-postgres`) |
| Runtime 서버 | ✅ 돌고 있음 | http://localhost:3001 |
| **Dashboard** | ✅ 돌고 있음 | **http://localhost:3030** ← 여기 열어 |

브라우저에서 **http://localhost:3030** 열면:
- 가상의 학습자 4명 (uj.choe, sumi, minho, jiwon) 카드
- 10개 멘션 → 텔레그램 매핑 (1주차 핵심 뷰)
- 실시간 비용 집계
- AI 채팅 (💬 버튼) — OpenRouter 키 넣으면 동작
- /smoke — 수동 스모크 테스트
- /admin — 일시정지 + audit log
- /agents/uj.choe — 상세 + 매니페스트

## 2. 만들어진 것 한눈에

```
/home/uj/projects/lego/
├── apps/
│   ├── runtime/             # Hono 기반 서버 (Slack/Telegram/GitHub webhook + AgentRunner)
│   └── dashboard/           # Next.js 14 대시보드 (브루탈리스트 + JetBrains Mono)
├── packages/
│   ├── runtime-sdk/         # defineAgent, defineTool, defineTrigger, defineHandler
│   ├── tools/               # Slack/Telegram/LLM (OpenRouter) 공통 도구
│   └── db/                  # Drizzle ORM + 14 테이블
├── agents/
│   └── _template/           # 학습자 시작 템플릿
├── fixtures/
│   └── slack-mentions.json  # 5개 시드 (질문/요청/일정/정보/애매)
├── scripts/
│   ├── setup.ts             # pnpm run setup 마법사
│   ├── seed-demo.ts         # 데모 데이터 시드 (이미 실행됨)
│   ├── check-secrets.ts     # 시크릿 누설 검사
│   ├── check-codeowners.ts  # CODEOWNERS 위반 검사
│   └── manifest-sync.ts     # 자동 동기화 (E.b)
├── docs/
│   ├── ONBOARDING.md        # 학습자용 (15명에게 배포)
│   ├── COOKBOOK.md          # 자주 쓰는 패턴 레시피
│   ├── OPERATIONS.md        # 너(운영자)용 가이드
│   └── ARCHITECTURE.md      # 시스템 다이어그램
├── .github/
│   ├── CODEOWNERS           # 본인 폴더만 수정 강제
│   └── workflows/ci.yml     # lint + typecheck + secret scan + CODEOWNERS
├── docker-compose.yml       # Postgres
├── Dockerfile               # Railway 배포용
├── railway.json             # Railway 빌드 설정
├── .env                     # 로컬 환경변수 (이미 채워둠 — DB만)
├── .env.example             # 운영 배포용 템플릿
├── README.md
├── CLAUDE.md                # 프로젝트 컨텍스트 (Claude Code용)
└── .claude/plans/
    ├── rego-agent-plan.md      # 너가 코멘트 단 원본
    └── FINAL-DECISIONS.md      # 결정사항 집계
```

## 3. 통과한 검증

| 검증 | 결과 |
|---|---|
| `pnpm typecheck` (전체 패키지) | ✅ 통과 |
| `pnpm test` (19개 테스트) | ✅ 통과 |
| `pnpm --filter @rego/dashboard build` | ✅ 통과 |
| Postgres 스키마 push | ✅ 14 테이블 생성 |
| 시드 데이터 (4 agents, 10 mentions, 20 smoke runs) | ✅ |
| Runtime API 응답 (`/api/agents`, `/api/feed/stats`, `/api/feed/mentions`) | ✅ |
| Dashboard 렌더링 (200 OK, 12KB HTML) | ✅ |

## 4. 너의 결정사항 모두 반영됨

- ✅ Private repo (`bearjun05/rego-agent`)
- ✅ 회사 슬랙 사용, 정책은 사용자가 자유 정의
- ✅ 자동 manifest 동기화 (E.b)
- ✅ 비용 한도 X, 실시간 집계만
- ✅ 무한루프: 분당 200 호출 / 100 LLM → 자동 정지 + audit
- ✅ 로그 영구 보존
- ✅ CODEOWNERS 본인 폴더 강제
- ✅ 일시정지 너만 가능
- ✅ Slack/Telegram/OpenRouter만 (1주차)
- ✅ 자동 + 수동 스모크 둘 다
- ✅ 모든 정보 모두 공개
- ✅ 멘션 → 텔레그램 매핑 한눈에 뷰
- ✅ AI 채팅 (단순 Q&A)
- ✅ 관리자 audit 페이지

## 5. OT 전에 너가 해야 할 일 (45분)

상세는 `docs/OPERATIONS.md`. 요약:

### A. 외부 서비스 인증 (인증 때문에 내가 못함)

1. **GitHub repo 생성** (5분)
   ```bash
   cd /home/uj/projects/lego
   gh repo create rego-agent --private --description "AI 에이전트 스터디 플랫폼"
   git init && git add . && git commit -m "feat: initial scaffold"
   git branch -M main
   git remote add origin git@github.com:bearjun05/rego-agent.git
   git push -u origin main
   ```

   → Settings → Branches → main 보호 켜기 + Code Owners 리뷰 필수

2. **OpenRouter** (5분)
   - openrouter.ai 가입 + 결제 카드 + 키 발급
   - 1Password에 `RegoAgent OpenRouter API Key` 저장

3. **Telegram 봇** (5분)
   - @BotFather → `/newbot` → 이름/핸들 정함
   - 토큰을 1Password에 `RegoAgent Telegram Bot Token`

4. **Slack App** (15분)
   - api.slack.com → Create App → "Rego Agent"
   - OAuth scopes: `app_mentions:read`, `chat:write`, `channels:history`, `channels:read`, `reactions:read`, `users:read`
   - 워크스페이스에 설치 → Bot Token (xoxb-...) + Signing Secret 받기
   - 1Password 두 항목 저장
   - 봇을 채널에 초대: `/invite @Rego Agent`

5. **Railway 프로젝트** (10분)
   - Railway 웹에서 New Project → GitHub repo 연결
   - Postgres 추가
   - Environment Variables에 1Password 토큰 5개 등록
   - 빌드 시작 → 도메인 받음 (예: `rego-agent-production.up.railway.app`)

6. **Slack Event Subscription URL 등록**
   - Railway 도메인 받은 다음에
   - Slack App → Event Subscriptions → Request URL = `https://<railway-domain>/webhooks/slack`
   - Subscribe to bot events: `app_mention` (+ 선택: `message.channels`, `reaction_added`)

7. **Telegram Webhook 등록**
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<railway-domain>/webhooks/telegram"
   ```

### B. OT 자료 (12:30 시작 전)

- 대시보드 화면을 미리 띄워두기 (시연용)
- ONBOARDING.md를 15명에게 공유 (Notion/Slack)
- 본인이 먼저 `pnpm run setup` 해서 첫 에이전트 등록 (시연)

## 6. 로컬 개발 명령어 (이미 돌고 있지만)

```bash
cd /home/uj/projects/lego

# 컨테이너 상태
docker compose ps

# 서비스 재시작
docker compose restart
pnpm --filter @rego/runtime exec tsx src/server.ts    # foreground
pnpm --filter @rego/dashboard exec next start -p 3030 # foreground

# 검증
pnpm test          # 19 tests
pnpm typecheck     # 모든 패키지
pnpm --filter @rego/dashboard build

# 데이터 추가 시드
pnpm tsx scripts/seed-demo.ts

# DB 직접 보기
docker exec -it rego-agent-postgres psql -U rego -d rego_agent

# Drizzle Studio (DB UI)
env DATABASE_URL='postgresql://rego:rego_local_password@localhost:5436/rego_agent' \
  pnpm --filter @rego/db db:studio
```

## 7. 시연 시 동작 데모 시나리오

`/smoke` 페이지로 가서:
1. 에이전트 `uj.choe` 선택
2. 즉시 멘션: `"환불 정책 어떻게 적용해야 하나요?"` 입력 → ▶ 실행
3. → 결과: status `failed` 또는 `success` (OpenRouter 키 없으면 LLM 호출 실패하지만 흐름은 보임)
4. OpenRouter 키 등록 후 다시 시도 → 진짜 LLM 분류 + 텔레그램 송신 (네 텔레그램 chat_id로)

## 8. 미해결 / 너가 결정해야 할 작은 것들

- **모델 정확한 이름**: OpenRouter에서 현재 사용 가능한 `claude-haiku-4.5` / `claude-sonnet-4.5`가 OpenRouter 표기로 정확히 뭔지 확인 필요 (`.env`의 `MODEL_CLASSIFY`/`MODEL_GENERATE` 갱신)
- **CODEOWNERS 채우기**: setup 마법사가 학습자별로 자동 추가. 너는 처음에 `bearjun05` 핸들이 박혀 있는 게 맞는지 확인만
- **`docs/ONBOARDING.md` 마지막 확인**: 사용자(학습자)에게 보낼 때 문구가 너 스타일이랑 맞는지

## 9. 트러블슈팅

서버가 죽었으면:

```bash
# Postgres
docker compose up -d

# Runtime
env $(grep -v '^#' .env | xargs) pnpm --filter @rego/runtime exec tsx src/server.ts > /tmp/rego-runtime.log 2>&1 &

# Dashboard
RUNTIME_URL=http://localhost:3001 pnpm --filter @rego/dashboard exec next start -p 3030 > /tmp/rego-dashboard.log 2>&1 &
```

로그:
```bash
tail -f /tmp/rego-runtime.log
tail -f /tmp/rego-dashboard.log
docker compose logs -f postgres
```

## 10. 진짜 마무리 — Github push

`.env` 파일은 .gitignore에 있음. 시크릿 누설 검사도 자동.

```bash
cd /home/uj/projects/lego
git status                              # 변경 사항 확인
gh repo create rego-agent --private
git init
git add .
git commit -m "feat: rego-agent v0.1.0 — 1주차 baseline + 대시보드"
git branch -M main
git remote add origin git@github.com:bearjun05/rego-agent.git
git push -u origin main
```

---

문서 다 만들어두기는 했어. `docs/ONBOARDING.md`, `docs/COOKBOOK.md`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `agents/_template/CLAUDE.md`, `README.md`.

뭐 안 되거나 헷갈리는 거 있으면 그냥 자연어로 부탁하면 돼. 행운을 빌어 OT 잘 풀려라 🚀

— Claude (Opus 4.7, 1M context) 

# 운영자 가이드 (준)

> 매주 수요일 12:30 OT 전에 챙겨야 할 것들 + 트러블슈팅.

## 사전 셋업 (한 번만, 약 45분)

순서는 [`.claude/plans/rego-agent-plan.md`](../.claude/plans/rego-agent-plan.md)의 4부 참고.

### Step 1: GitHub repo (5분)

```bash
gh repo create rego-agent --private --description "AI 에이전트 스터디 플랫폼"
# 본 디렉토리에서:
git init
git add .
git commit -m "feat: initial scaffold"
git branch -M main
git remote add origin git@github.com:bearjun05/rego-agent.git
git push -u origin main
```

GitHub repo 설정:
- Settings → Branches → Add rule for `main`:
  - ✅ Require pull request before merging
  - ✅ Require review from Code Owners
  - ✅ Require status checks (CI 통과)
- Settings → Secret Scanning → 켜기 (private라 GitHub Advanced Security 필요할 수 있음)

### Step 2: Railway 프로젝트 (10분)

```bash
railway login
railway init  # rego-agent 이름
```

또는 웹: railway.com → New Project → Empty Project → 이름 "rego-agent"

GitHub 연결: Service → Settings → Source → bearjun05/rego-agent

Postgres 추가: New → Database → PostgreSQL (자동으로 `DATABASE_URL` 주입)

→ Railway 도메인 받음: `rego-agent-production.up.railway.app`

### Step 3: OpenRouter (5분)

1. openrouter.ai 계정
2. Credits → 카드 등록 + 한도 $200/월
3. Keys → Create Key (이름: "rego-agent")
4. 키 복사

### Step 4: Telegram 봇 (5분)

1. Telegram에서 @BotFather → `/newbot`
2. 이름: `Rego Agent`, 핸들: `rego_agent_bot` (이미 있으면 다른 거)
3. 토큰 받음
4. `/setcommands` → 
```
start - 본인 닉네임 등록
whoami - 내 chat_id 확인
help - 도움말
```

Webhook 등록 (배포 후):
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<railway-domain>/webhooks/telegram"
```

### Step 5: Slack App (15분)

api.slack.com → Create App → From scratch

- 이름: `Rego Agent`
- 워크스페이스: (회사 슬랙)

OAuth & Permissions → Bot Token Scopes:
- `app_mentions:read`
- `channels:history`
- `channels:read`
- `chat:write`
- `reactions:read`
- `users:read`

Event Subscriptions:
- Enable Events
- Request URL: `https://<railway-domain>/webhooks/slack`
- Subscribe to bot events:
  - `app_mention`
  - `message.channels` (선택)
  - `reaction_added` (선택)

Install to Workspace → 권한 승인

Bot User OAuth Token (xoxb-...) 복사
Basic Information → Signing Secret 복사

Bot을 관련 채널에 초대:
```
/invite @Rego Agent
```

### Step 6: 1Password (5분)

```bash
op item create --category=password --vault=mini-server \
  --title="RegoAgent Slack Signing Secret" password=$VALUE
op item create --category=password --vault=mini-server \
  --title="RegoAgent Slack Bot Token" password=$VALUE
op item create --category=password --vault=mini-server \
  --title="RegoAgent Telegram Bot Token" password=$VALUE
op item create --category=password --vault=mini-server \
  --title="RegoAgent OpenRouter API Key" password=$VALUE
op item create --category=password --vault=mini-server \
  --title="RegoAgent GitHub Webhook Secret" password=$RANDOM_STRING
```

### Step 7: Railway 환경변수 (5분)

Workspace token으로 자동화 (이미 `~/.claude/CLAUDE.md`에 있음):

```bash
TOKEN=$(op read "op://mini-server/RAILWAY_WORKSPACE_TOKEN/credential")

# 또는 Railway 웹: Variables 탭에서 직접

# 다음 키 설정:
SLACK_SIGNING_SECRET=...
SLACK_BOT_TOKEN=...
TELEGRAM_BOT_TOKEN=...
OPENROUTER_API_KEY=...
GITHUB_WEBHOOK_SECRET=...
MODEL_CLASSIFY=anthropic/claude-haiku-4.5
MODEL_GENERATE=anthropic/claude-sonnet-4.5
MODEL_CHAT=anthropic/claude-sonnet-4.5
NODE_ENV=production
RUNTIME_PORT=3001
PUBLIC_BASE_URL=https://<railway-domain>
```

### Step 8: 첫 배포 확인

```bash
curl https://<railway-domain>/health
# → {"ok":true,"ts":"..."}
```

대시보드는 별도 서비스로 추가 배포:
- Railway에서 New Service → Same GitHub repo
- Root Directory: `apps/dashboard`
- Build: `cd ../.. && pnpm install && pnpm --filter @rego/dashboard build`
- Start: `cd ../.. && pnpm --filter @rego/dashboard start`
- Variables → `RUNTIME_URL=https://<runtime-domain>`

또는 같은 컨테이너에서 둘 다 실행하려면 monorepo 구조로 두 process 실행 (Procfile-style).

## OT 당일 흐름 (12:30 - 14:00)

- 12:30 ~ 12:45: 소개 + 대시보드 시연
- 12:45 ~ 13:30: 함께 셋업 (각자 `pnpm run setup`)
- 13:30 ~ 13:45: 본인 폴더에서 Claude Code 띄우고 첫 수정
- 13:45 ~ 14:00: 슬랙에서 서로 멘션해보기 + 대시보드 구경

준비물:
- 스크린: 대시보드 / 슬랙 / GitHub
- 백업 fixture 시연용 (`/smoke` 페이지)

## 트러블슈팅

### Railway runtime이 안 뜸

```bash
railway logs
```

- DATABASE_URL 없음 → Postgres 서비스가 연결되어 있나 확인
- ts-node 또는 tsx 에러 → `pnpm install` 다시
- Port 충돌 → `RUNTIME_PORT` 명시

### Slack webhook 401 / signature mismatch

- `SLACK_SIGNING_SECRET` 정확한지 확인
- Slack App 재설치 후 새 secret 받았는지

### Telegram /start 응답 없음

- `TELEGRAM_BOT_TOKEN` 확인
- Webhook URL 등록 확인:
  ```bash
  curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
  ```
- 봇이 학습자 채팅 차단된 건 아닌지

### 에이전트가 로드 안 됨

```bash
railway logs | grep "agents"
```

- `agent.config.ts` import 에러 → tsx가 트랜스파일 못 했을 수 있음
- `handler.ts` 에서 `defineHandler` named export 빠짐

### OpenRouter 401

- API 키 확인
- 결제 카드 등록됐는지
- 모델 이름이 OpenRouter 실제 ID와 일치하는지 (예: `anthropic/claude-3-5-haiku`)

### 누군가 폭주

대시보드 `/admin` → 일시정지 버튼.

또는 직접 DB:
```sql
UPDATE agents SET is_paused = true, paused_reason = 'manual' WHERE name = 'xxx';
```

## 매주 OT 전 체크

- [ ] Railway 살아있는지: `curl <domain>/health`
- [ ] 대시보드 접근 가능
- [ ] OpenRouter 잔액 확인
- [ ] 지난 주 비용 audit log 확인
- [ ] 새 fixture 추가 (다음 주 챌린지)

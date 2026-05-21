# Railway 배포 런북

자체 우분투 서버(Caddy + Docker Postgres + tsx)에서 **Railway 3서비스**로 이전하는 절차.
기능은 동일하게 유지한다. 코드 쪽 준비는 이미 끝나 있다(아래 "코드 변경 요약" 참고).

> 롤백 대비: 자체서버는 안정화될 때까지 **병행 유지**한다. Slack/Telegram/GitHub의
> webhook URL을 Railway로 바꾸는 순간 트래픽이 Railway로 넘어가므로, URL 전환은 맨 마지막에.

---

## 0. 사전 준비

- Railway 계정 + 프로젝트 생성 권한
- 1Password mini-server vault 접근 (시크릿 값)
- 로컬에 `railway` CLI (`npm i -g @railway/cli`, `railway login`)
- 기존 자체서버의 Postgres 접속 정보 (데이터 이전용)

---

## 1. 코드 변경 요약 (이미 적용됨)

| 파일 | 변경 |
|------|------|
| `.dockerignore` (신규) | `node_modules`/`.env`/`.git`/빌드산출물 제외 — **시크릿이 이미지에 안 들어감** |
| `Dockerfile` | `--frozen-lockfile`(재현 빌드), runtime 스테이지 정리, EXPOSE 제거(동적 PORT) |
| `Dockerfile.dashboard` (신규) | Next.js 빌드/기동. `RUNTIME_URL`을 build ARG로 받음 |
| `apps/runtime/src/server.ts` | `process.env.PORT` 우선, Railway면 `::`(IPv6 듀얼스택) 바인딩, 부팅 시 변경 에이전트 분석 |
| `apps/runtime/src/webhooks/github.ts` | Railway면 git pull/reload 생략(네이티브 재배포가 처리), 폴더경고만 |

> 검증됨: `docker build` 성공 + 컨테이너가 주입된 `PORT`로 부팅, `::` 바인딩 시 IPv4/IPv6 양쪽 `/health` 200.

---

## 2. 서비스 생성

```bash
railway init        # 새 프로젝트 rego-agent
```

Railway 대시보드에서 3개 서비스 구성:

1. **Postgres** — "New → Database → PostgreSQL". `DATABASE_URL` 변수 자동 생성.
2. **runtime** — repo 연결. Settings:
   - Build: Dockerfile (`Dockerfile`)  ← 루트 `railway.json`이 기본값
   - Healthcheck Path: `/health`
   - Networking: **공개 도메인 생성** (Slack/GitHub/Telegram webhook 수신용)
3. **dashboard** — 같은 repo 연결. Settings:
   - 변수 `RAILWAY_DOCKERFILE_PATH=Dockerfile.dashboard` (이 서비스만 dashboard용 Dockerfile 사용)
   - Healthcheck Path: `/` (또는 비활성)
   - Networking: **공개 도메인 생성** (사용자 접속용)

---

## 3. 환경변수 (Railway)

`railway variables --service runtime --set KEY=VALUE` 또는 대시보드에서.

> ⚠️ **시크릿 출처 주의 (2026-05-21 확인된 실제 상태)**
> - `.env.1p`는 `op://mini-server/RegoAgent *` 항목을 참조하지만 **그 항목들은 1Password에 없다.**
> - 실제 값이 있는 곳: 로컬 `.env`(gitignore) — `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`,
>   `GITHUB_WEBHOOK_SECRET`. **`SLACK_SIGNING_SECRET`·`SLACK_BOT_TOKEN`은 비어 있음** → 별도 발급/재사용 필요.
> - 따라서 Railway 변수는 1Password가 아니라 **로컬 `.env` 값**으로 채우고, Slack 두 키만 새로 확보한다.

### runtime 서비스
```
DATABASE_URL=${{Postgres.DATABASE_URL}}        # reference 변수 (Railway Postgres)
SLACK_SIGNING_SECRET=<신규/재사용 — 아래 주의 참고>
SLACK_BOT_TOKEN=<신규/재사용 — xoxb-…>
SLACK_MONITOR_CHANNELS=                          # 비우면 전체, 또는 C0…,채널명
TELEGRAM_BOT_TOKEN=<로컬 .env 값>
OPENROUTER_API_KEY=<로컬 .env 값 (sk-…)>
GITHUB_WEBHOOK_SECRET=<로컬 .env 값>
ADMIN_PASSWORD=<직접 지정>
PUBLIC_BASE_URL=https://<runtime 공개도메인>
MODEL_CLASSIFY=deepseek/deepseek-v4-flash
MODEL_GENERATE=deepseek/deepseek-v4-flash
MODEL_CHAT=deepseek/deepseek-v4-flash
```

> ⛔ **`NODE_OPTIONS=--dns-result-order=ipv4first` 를 Railway에 넣지 말 것.**
> 자체서버 `.env.1p`엔 이게 있는데, Railway 사설망(IPv6) DNS를 깨뜨린다. (`SELF_HOSTED_IPV4_ONLY`도 마찬가지로 설정 금지)

> Slack 두 키는 **rego 전용 Slack 앱("Rego Agent")을 새로 만들어** 발급해야 한다(원래 계획엔
> 있었으나 미생성 단계). 1Password의 `SLACK_BOT_*`는 redirect가 `team-api.snoio.com`을 가리키는
> **다른 서비스 앱**이라 rego용이 아니다. 절차: [slack-setup.md](./slack-setup.md).

### dashboard 서비스
```
RUNTIME_URL=http://${{runtime.RAILWAY_PRIVATE_DOMAIN}}:${{runtime.PORT}}   # 사설망
DASHBOARD_BASE_URL=https://<dashboard 공개도메인>
ADMIN_PASSWORD=<runtime과 동일>
RAILWAY_DOCKERFILE_PATH=Dockerfile.dashboard
```

> `RUNTIME_URL`은 dashboard의 **빌드 시점**에 next.config 프록시로 구워진다(코드에서 ARG 처리).
> 사설망이 안 되면 폴백으로 `https://<runtime 공개도메인>` 사용.

> `PORT`는 Railway가 자동 주입하므로 직접 설정하지 않는다. `RAILWAY_ENVIRONMENT`도 자동.

---

## 4. DB 스키마 + 데이터 이전

### 4-1. 스키마 push
```bash
# Railway Postgres에 스키마 생성 (drizzle push)
railway run --service runtime pnpm db:push
# 또는 로컬에서: DATABASE_URL=<Railway public proxy URL> pnpm db:push
```

### 4-2. 데이터 이전 (필수 — 코드로 복구 불가)
`slack_user_id`(멘션 라우팅 키)와 `telegram_chat_id`(알림 대상)는 **DB에만** 존재한다.
이걸 안 옮기면 라우팅·알림이 전멸한다.

```bash
# 자체서버 Postgres에서 핵심 테이블 덤프 (data-only)
PGPASSWORD=<old> pg_dump -h <old-host> -p 5436 -U rego -d rego_agent \
  --data-only --no-owner \
  -t agents -t telegram_pending -t slack_mentions -t telegram_messages \
  > rego-data.sql

# Railway Postgres로 복원 (public proxy 접속 문자열 사용)
psql "<Railway DATABASE_URL public proxy>" < rego-data.sql
```

### 4-3. 검증
```bash
psql "<Railway DATABASE_URL>" -c \
  "select name, slack_user_id, telegram_chat_id from agents order by name;"
```
`slack_user_id`/`telegram_chat_id`가 채워져 있어야 한다.

> 재현성 보강: `scripts/roster.json`의 각 항목에 `slackUserId`를 채워두면
> `pnpm tsx scripts/seed-attendees.ts`로 언제든 복구 가능(COALESCE라 기존 값 비파괴).

---

## 5. 배포 + webhook URL 전환 (맨 마지막)

1. main push → Railway가 runtime/dashboard 자동 재배포.
   - **Watch Paths**(서비스 Settings)로 불필요 재배포 억제: `apps/**`, `packages/**`, `agents/**`, `Dockerfile*`, `package.json`, `pnpm-lock.yaml`.
2. webhook URL 재등록:
   - **Slack**: [docs/slack-setup.md](./slack-setup.md) 참고 → Request URL을 `https://<runtime>/webhooks/slack`
   - **Telegram**: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<runtime>/webhooks/telegram"`
   - **GitHub**: repo Settings → Webhooks → `https://<runtime>/webhooks/github` (folder-violation 경고/analyze용; 자동배포와 별개)

---

## 6. 배포 후 검증 (E2E)

```bash
curl https://<runtime>/health         # {"ok":true,...}
curl https://<runtime>/               # {"agentsLoaded":16,...}
```
- dashboard 접속 → 에이전트 그리드/피드/멘션플로우 정상.
- **Slack 실측**: 감시 채널에서 참가자를 실제 태그 → runtime 로그에
  `event message: message_with_mention` → `mention matched N agents` → 해당 Telegram 알림 도착.
- 같은 멘션 재전송 시 중복 실행 없음(`duplicate event_id … skip` 로그).
- 학습자 폴더 더미 커밋 push → Railway 재배포 → 반영 확인. 폴더경계 위반 시 Telegram 경고.
- Telegram `/start <이름>` → chat_id 매핑 확인.

---

## 7. 학습자 push → 반영 모델 (변경점)

| | 자체서버(기존) | Railway(신규) |
|---|---|---|
| 코드 반영 | github webhook → `git checkout origin/main -- agents/` + 핫리로드(무중단) | main push → **네이티브 재배포**(~1~2분, 전체 재시작) |
| 폴더경계 경고 | webhook | webhook 유지(코드 반영과 별개) |
| AI 분석(analyzeAgent) | webhook에서 변경분 | **새 컨테이너 부팅 시** 변경분만(코드 해시 비교로 LLM 스킵) |

> 15명이 동시에 push하면 재배포가 큐잉될 수 있다. Watch Paths로 `agents/**` 변경 시에만 재배포되게 해 빈도를 줄인다.

---

## 8. 트러블슈팅

- **dashboard→runtime 502/연결 실패**: `RUNTIME_URL` 사설망 형식 확인. 안 되면 runtime 공개 https로 폴백.
- **runtime healthcheck 실패**: `PORT` 직접 설정했는지 확인(설정 금지). 로그에서 `listening on :::<port>` 확인.
- **Slack 멘션 안 옴**: [docs/slack-setup.md](./slack-setup.md) 체크리스트(이벤트 구독/스코프/채널 초대).
- **알림이 일부 사람한테만**: `agents.telegram_chat_id` 매핑 확인(4-3). `/start` 재등록.
- **빌드 실패(lockfile)**: `pnpm install` 후 `pnpm-lock.yaml` 커밋(현재는 동기화 상태).

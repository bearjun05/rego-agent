# rego-agent

스파르타 AI 에이전트 스터디 플랫폼. 15명의 비개발자가 8주간 본인만의 AI 비서를 깎는다.

> 운영자(준)가 Slack/Telegram/LLM API와 인프라를 깔아주고,
> 학습자들은 본인 폴더에서 정책만 자유롭게 짠다.

## 구조

```
rego-agent/
├── apps/
│   ├── runtime/         # Hono 기반 서버 (Slack/Telegram webhook + AgentRunner)
│   └── dashboard/       # Next.js 14 대시보드
├── packages/
│   ├── runtime-sdk/     # defineAgent, defineTool, defineTrigger
│   ├── tools/           # Slack/Telegram/LLM 공통 도구
│   └── db/              # Drizzle ORM 스키마
├── agents/
│   ├── _template/       # 시작 템플릿 (setup 마법사가 복사)
│   └── <본인이름>/       # 각자의 에이전트
├── fixtures/            # 공통 스모크 시나리오
├── scripts/             # setup 마법사, manifest sync, secret scan
└── docs/                # ONBOARDING, COOKBOOK, ARCHITECTURE
```

## 빠른 시작 (학습자)

```bash
git clone https://github.com/bearjun05/rego-agent.git
cd rego-agent
pnpm install
pnpm run setup        # 본인 폴더 생성 + 텔레그램 연결
# 안내 따라가면 끝. 자세한 건 docs/ONBOARDING.md
```

## 빠른 시작 (운영자, 로컬)

### 옵션 A: 1Password Service Account 패턴 (추천 — 평문 토큰 디스크에 X)

```bash
pnpm install
docker compose up -d                # Postgres
./scripts/start.sh                  # runtime + dashboard, op://로 시크릿 주입
./scripts/status.sh                 # 상태 확인
./scripts/stop.sh                   # 종료
```

`.env.1p`에 `op://mini-server/...` 참조만 두고, 시작 시 op CLI가 자동으로 실제 값으로 치환.

서버 재부팅 시 자동 시작:
```bash
sudo bash scripts/install-systemd.sh
sudo systemctl start rego-agent
journalctl -u rego-agent -f         # 로그
```

### 옵션 B: 평문 .env (간단)

```bash
cp .env.example .env       # 토큰 채우기
pnpm db:push
pnpm seed
pnpm dev
```

## 1주차 동작

1. 슬랙에서 본인 이름이 태그됨 (`@uj.choe`)
2. Railway 런타임이 webhook 수신
3. 본인 폴더의 `handler.ts` 실행
4. 분류 → 텔레그램 송신
5. 대시보드에 실시간 표시

## 의사결정

자세한 건 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)와 `.claude/plans/`.

핵심:
- 모노레포 (turborepo + pnpm)
- LLM 게이트웨이: OpenRouter (Haiku 4.5 분류, Sonnet 4.5 답변)
- DB: Postgres (Drizzle ORM, 영구 로그)
- 호스팅: Railway 단일 서비스
- 시각화: React Flow 기반 (Phase 2)
- 비용 제한: 없음 (실시간 집계만)
- 무한루프: 분당 200 호출 또는 100 LLM 시 자동 정지

## 학습자 가이드

[docs/ONBOARDING.md](docs/ONBOARDING.md) → 1시간 안에 baseline 동작.

## 운영자 가이드

[docs/OPERATIONS.md](docs/OPERATIONS.md) → 사전 셋업 + 트러블슈팅.

## 라이센스

내부용. 외부 공개 금지.

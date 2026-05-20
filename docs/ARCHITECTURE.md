# 아키텍처

## 시스템 다이어그램

```
┌─ 로컬 (학습자 노트북) ─────────────────────────┐
│   Claude Code (페어 프로그래머)                 │
│   ↓ agents/<자기>/ 코드 작성                    │
│   ↓ git push                                    │
└──────────────────┬──────────────────────────────┘
                   ▼
            ┌──────────────┐
            │ GitHub repo  │ (private)
            └──────┬───────┘
                   │ webhook (push)
                   ▼
┌─ Railway 단일 서비스 ─────────────────────────┐
│                                                │
│  ┌─ Webhooks ──────────────────────────────┐  │
│  │ /webhooks/slack    /webhooks/github     │  │
│  │ /webhooks/telegram                      │  │
│  └────────────┬────────────────────────────┘  │
│               ▼                                │
│  ┌─ AgentRegistry ─────────────────────────┐  │
│  │ agents/<name>/ 폴더 동적 로드            │  │
│  │ manifest sync (E.b 자동 동기화)         │  │
│  └────────────┬────────────────────────────┘  │
│               ▼                                │
│  ┌─ AgentRunner ───────────────────────────┐  │
│  │ 이벤트 → 핸들러 매칭 → ctx 주입         │  │
│  │ timeout / call limits / 비용 집계       │  │
│  └────────────┬────────────────────────────┘  │
│               ▼                                │
│  ┌─ Tools + LLM Proxy ─────────────────────┐  │
│  │ Slack / Telegram / OpenRouter           │  │
│  │ Audit + Rate limit (runaway 자동 정지)  │  │
│  └────────────┬────────────────────────────┘  │
│               ▼                                │
│  ┌─ Postgres + EventBus ───────────────────┐  │
│  │ 모든 활동을 영구 저장                    │  │
│  │ SSE로 대시보드에 실시간 푸시            │  │
│  └─────────────────────────────────────────┘  │
└────────────────────┬───────────────────────────┘
                     │ SSE + REST
                     ▼
            ┌─────────────────┐
            │ Next.js         │
            │ Dashboard       │
            │ (실시간 + AI 챗) │
            └─────────────────┘
```

## 데이터 흐름 (Slack 멘션 처리)

1. 누군가 슬랙에서 `@uj_choe` 태그
2. Slack → POST `/webhooks/slack` (signed)
3. 서명 검증 후 `slack_mentions` 테이블 저장
4. `matchAgentsForEvent(event)` → 이름 매칭으로 `uj_choe` 에이전트 선택
5. `runAgentForEvent(agent, event, { sourceSlackMentionId })`
   - `runs` 테이블에 row 생성
   - `createContext()` — 본인 tools/llm/state/peers 주입
   - 핸들러 실행 (timeout 30s)
   - LLM 호출 → `llm_calls` 기록 + 비용 집계
   - 도구 호출 → `tool_calls` 기록
   - `telegram.send` 호출 시 → `telegram_messages` 기록 + `sourceSlackMentionId` 매핑
6. `runs` finalize → SSE 푸시
7. 대시보드 활동 피드 / 멘션 매핑 뷰에 즉시 노출

## 권한 모델

### 사용자 (학습자)

- 본인 폴더 `agents/<자기>/` 에서만 자유롭게 수정 (CODEOWNERS)
- 공통 파일 (`packages/`, `apps/`, `package.json` 등) 변경은 PR + 운영자 승인
- 런타임에서:
  - 본인 chat_id로만 텔레그램 전송 (다른 사람 chat_id 못 씀)
  - 본인 namespace의 KV state만 접근
  - 다른 사람 manifest는 read-only
  - secret은 `tool.secrets`에 선언된 것만

### 운영자 (관리자)

- 모든 폴더 PR 머지 권한
- 대시보드 /admin에서 에이전트 일시정지/재개
- audit 로그 전체 조회
- OpenRouter API 키 / Slack/Telegram 토큰 관리 (Railway env)

### 시스템

- 분당 200 호출 또는 100 LLM 시 자동 정지 + audit (`severity: critical`)
- secret 누설 시도 시 pre-commit + CI gitleaks가 차단

## DB 스키마 (요약)

자세한 건 `packages/db/src/schema.ts`.

- `agents` — 사람당 1 row, manifest 캐시
- `events` — 모든 이벤트 영구 로그
- `runs` — 핸들러 실행 단위
- `llm_calls` / `tool_calls` — run 안의 step
- `slack_mentions` — 받은 멘션
- `telegram_messages` — 보낸 메시지 (← `triggeredBySlackMentionId`로 멘션과 매핑)
- `smoke_runs` — 자동/수동 스모크 결과
- `fixtures` — 사용자 추가 fixture
- `audit_logs` — 보안/통제 감사 (영구)
- `kv_state` — 에이전트별 namespace KV
- `rate_limit` — 분 단위 윈도우 카운터
- `chat_messages` — 대시보드 AI 채팅 히스토리

## 시각화 (Phase 2)

`agent_graphs` 테이블에 commit별 노드/엣지 스냅샷 저장.
React Flow로 렌더링.
Static analysis (handler.ts AST) + AI 보강.

## 비용 통제

- 한도 자체는 없음 (사용자 결정 G-4)
- 실시간 집계 → 대시보드 표시
- 모델 화이트리스트로 비싼 모델 차단 (Opus 등 미설정 시 sonnet으로 fallback)
- 무한루프 자동 정지로 사고 방지

## 확장 포인트

새 트리거: `runtime-sdk/types.ts`의 `TriggerTypeSchema` 확장 + webhook receiver 추가
새 도구: `packages/tools/` 또는 `agents/<자기>/tools/`
새 모델: OpenRouter 가격 테이블에 추가 (`packages/tools/src/llm.ts`)
새 분석: 2주차+에서 capability extractor 추가 가능

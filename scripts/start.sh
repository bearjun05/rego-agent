#!/bin/bash
# rego-agent 시작 스크립트
# 1Password Service Account 토큰으로 시크릿 주입 → runtime + dashboard 실행
# OpenClaw 패턴 그대로.

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG_DIR="/tmp/rego-agent"
mkdir -p "$LOG_DIR"

C_RESET=$'\e[0m'
C_DIM=$'\e[2m'
C_BOLD=$'\e[1m'
C_CYAN=$'\e[36m'
C_GREEN=$'\e[32m'
C_YELLOW=$'\e[33m'
C_RED=$'\e[31m'

log() { echo "${C_DIM}[$(date '+%H:%M:%S')]${C_RESET} $*"; }
ok()  { echo "  ${C_GREEN}✓${C_RESET} $*"; }
warn(){ echo "  ${C_YELLOW}⚠${C_RESET} $*"; }
err() { echo "  ${C_RED}✗${C_RESET} $*"; }

echo "${C_BOLD}${C_CYAN}┌─ REGO-AGENT START ──────────────────────────────┐${C_RESET}"

# ─────────────────────────────────────────────────────────
# 1. op CLI 인증 확인
# ─────────────────────────────────────────────────────────
log "1) 1Password Service Account 확인"
if [ -f "$HOME/.op_token" ]; then
  source "$HOME/.op_token"
fi
if ! op vault list >/dev/null 2>&1; then
  err "op CLI 인증 실패. ~/.op_token 확인 또는 OP_SERVICE_ACCOUNT_TOKEN 설정 필요"
  exit 1
fi
ok "op 인증 OK (mini-server vault 접근 가능)"

# ─────────────────────────────────────────────────────────
# 2. 1Password 항목 존재 검사 (없으면 안내, fail-soft)
# ─────────────────────────────────────────────────────────
log "2) 1Password 항목 점검"
MISSING=()
for item in \
  "RegoAgent Slack Signing Secret" \
  "RegoAgent Slack Bot Token" \
  "RegoAgent Telegram Bot Token" \
  "RegoAgent OpenRouter API Key" \
  "RegoAgent GitHub Webhook Secret"; do
  if op item get "$item" --vault mini-server >/dev/null 2>&1; then
    ok "$item"
  else
    warn "$item — 미등록"
    MISSING+=("$item")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  warn "다음 항목들이 1Password에 없어요:"
  for m in "${MISSING[@]}"; do
    echo "    - $m"
  done
  echo ""
  echo "  ${C_DIM}이 항목들은 서비스 계정으로 자동 생성 불가.${C_RESET}"
  echo "  ${C_DIM}1Password 앱/웹에서 mini-server vault에 직접 추가하세요.${C_RESET}"
  echo "  ${C_DIM}없으면 해당 기능만 비활성화되고 나머지는 정상 동작합니다.${C_RESET}"
  echo ""
fi

# ─────────────────────────────────────────────────────────
# 3. Postgres 실행 확인 / 시작
# ─────────────────────────────────────────────────────────
log "3) Postgres (Docker) 확인"
if docker ps --format '{{.Names}}' | grep -q '^rego-agent-postgres$'; then
  ok "이미 동작 중"
else
  warn "시작 중..."
  docker compose up -d
  for i in $(seq 1 30); do
    if docker exec rego-agent-postgres pg_isready -U rego -d rego_agent >/dev/null 2>&1; then
      ok "Postgres ready"
      break
    fi
    sleep 1
  done
fi

# ─────────────────────────────────────────────────────────
# 4. 기존 프로세스 종료 (있으면)
# ─────────────────────────────────────────────────────────
log "4) 기존 프로세스 정리"
pkill -f 'tsx src/server.ts' 2>/dev/null && ok "runtime 종료" || true
pkill -f 'next start -p 3030' 2>/dev/null && ok "dashboard 종료" || true
sleep 1

# ─────────────────────────────────────────────────────────
# 5. Runtime 실행 (op run으로 시크릿 주입)
# ─────────────────────────────────────────────────────────
log "5) Runtime 실행 (op run으로 시크릿 자동 주입)"
nohup op run --env-file="$ROOT/.env.1p" --no-masking -- \
  pnpm --filter @rego/runtime exec tsx src/server.ts \
  > "$LOG_DIR/runtime.log" 2>&1 &
RUNTIME_PID=$!
echo $RUNTIME_PID > "$LOG_DIR/runtime.pid"
ok "runtime PID: $RUNTIME_PID (log: $LOG_DIR/runtime.log)"

# wait for runtime to be ready
for i in $(seq 1 15); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    ok "runtime ready (http://localhost:3001)"
    break
  fi
  sleep 1
done

# ─────────────────────────────────────────────────────────
# 6. Dashboard 실행
# ─────────────────────────────────────────────────────────
log "6) Dashboard 실행"
nohup env RUNTIME_URL=http://localhost:3001 \
  pnpm --filter @rego/dashboard exec next start -p 3030 \
  > "$LOG_DIR/dashboard.log" 2>&1 &
DASHBOARD_PID=$!
echo $DASHBOARD_PID > "$LOG_DIR/dashboard.pid"
ok "dashboard PID: $DASHBOARD_PID (log: $LOG_DIR/dashboard.log)"

for i in $(seq 1 15); do
  if curl -sf http://localhost:3030/ >/dev/null 2>&1; then
    ok "dashboard ready (http://localhost:3030)"
    break
  fi
  sleep 1
done

# ─────────────────────────────────────────────────────────
# 7. 최종 확인
# ─────────────────────────────────────────────────────────
echo ""
echo "${C_BOLD}${C_GREEN}└─ 시작 완료 ─────────────────────────────────────┘${C_RESET}"
echo ""
echo "  외부: ${C_BOLD}https://rego.jotto.in${C_RESET}"
echo "  로컬: http://localhost:3030  (dashboard)"
echo "        http://localhost:3001  (runtime API)"
echo ""
echo "  로그:"
echo "    tail -f $LOG_DIR/runtime.log"
echo "    tail -f $LOG_DIR/dashboard.log"
echo ""
echo "  종료: ./scripts/stop.sh"
echo "  상태: ./scripts/status.sh"

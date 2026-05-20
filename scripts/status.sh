#!/bin/bash
# rego-agent 상태 확인

C_GREEN=$'\e[32m'
C_RED=$'\e[31m'
C_DIM=$'\e[2m'
C_BOLD=$'\e[1m'
C_RESET=$'\e[0m'

check() {
  local name=$1
  local url=$2
  if curl -sf -m 3 "$url" >/dev/null 2>&1; then
    echo "  ${C_GREEN}●${C_RESET} $name  ${C_DIM}($url)${C_RESET}"
  else
    echo "  ${C_RED}○${C_RESET} $name  ${C_DIM}($url) — 응답 없음${C_RESET}"
  fi
}

echo "${C_BOLD}rego-agent 상태${C_RESET}"
echo ""

# Postgres
if docker ps --format '{{.Names}}' | grep -q '^rego-agent-postgres$'; then
  status=$(docker exec rego-agent-postgres pg_isready -U rego -d rego_agent 2>&1 | head -1)
  echo "  ${C_GREEN}●${C_RESET} Postgres  ${C_DIM}$status${C_RESET}"
else
  echo "  ${C_RED}○${C_RESET} Postgres  ${C_DIM}— 컨테이너 없음${C_RESET}"
fi

check "Runtime " "http://localhost:3001/health"
check "Dashboard" "http://localhost:3030/"
check "Public  " "https://rego.jotto.in/"

echo ""
echo "${C_BOLD}프로세스${C_RESET}"
pgrep -af 'tsx src/server.ts' 2>/dev/null | sed 's/^/  /' || echo "  ${C_DIM}runtime 프로세스 없음${C_RESET}"
pgrep -af 'next start -p 3030' 2>/dev/null | sed 's/^/  /' || echo "  ${C_DIM}dashboard 프로세스 없음${C_RESET}"

echo ""
echo "${C_BOLD}최근 로그 (5줄)${C_RESET}"
if [ -f /tmp/rego-agent/runtime.log ]; then
  echo "  ── runtime.log ──"
  tail -5 /tmp/rego-agent/runtime.log | sed 's/^/    /'
fi
if [ -f /tmp/rego-agent/dashboard.log ]; then
  echo "  ── dashboard.log ──"
  tail -5 /tmp/rego-agent/dashboard.log | sed 's/^/    /'
fi

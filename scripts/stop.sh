#!/bin/bash
# rego-agent 종료 스크립트

LOG_DIR="/tmp/rego-agent"

C_GREEN=$'\e[32m'
C_DIM=$'\e[2m'
C_RESET=$'\e[0m'

stop_pidfile() {
  local name=$1
  local pidfile="$LOG_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "${C_GREEN}✓${C_RESET} $name (PID $pid) 종료"
    fi
    rm -f "$pidfile"
  fi
}

stop_pidfile dashboard
stop_pidfile runtime

# 누수 정리
pkill -f 'tsx src/server.ts' 2>/dev/null || true
pkill -f 'next start -p 3030' 2>/dev/null || true
pkill -f 'op run.*\.env\.1p' 2>/dev/null || true

echo "${C_DIM}Postgres는 docker compose down 으로 별도 종료${C_RESET}"

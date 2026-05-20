#!/bin/bash
# systemd unit 등록 (선택사항 — 서버 재부팅 시 자동 시작)
# 실행: sudo bash scripts/install-systemd.sh

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="$(whoami)"

if [ "$EUID" -ne 0 ]; then
  echo "sudo로 실행해주세요: sudo bash $0"
  exit 1
fi

cat > /etc/systemd/system/rego-agent.service << EOF
[Unit]
Description=rego-agent runtime + dashboard (스파르타 AI 에이전트 스터디)
After=docker.service network-online.target
Wants=docker.service

[Service]
Type=forking
User=uj
Group=uj
WorkingDirectory=$ROOT
Environment="HOME=/home/uj"
Environment="PATH=/home/uj/.npm-global/bin:/home/uj/.local/bin:/usr/local/bin:/usr/bin:/bin"
# ~/.op_token (export 형식)은 start.sh가 source로 읽음
ExecStart=$ROOT/scripts/start.sh
ExecStop=$ROOT/scripts/stop.sh
Restart=on-failure
RestartSec=10s
TimeoutStartSec=120s

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable rego-agent.service
echo "✓ systemd unit 등록 완료"
echo ""
echo "명령어:"
echo "  sudo systemctl start rego-agent     # 시작"
echo "  sudo systemctl status rego-agent    # 상태"
echo "  sudo systemctl stop rego-agent      # 중지"
echo "  sudo systemctl restart rego-agent   # 재시작"
echo "  journalctl -u rego-agent -f         # 로그"

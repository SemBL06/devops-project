#!/usr/bin/env bash
set -Eeuo pipefail
if [[ $EUID -ne 0 ]]; then echo 'Run with sudo: sudo ./scripts/install-timers.sh' >&2; exit 1; fi
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
install -m 0644 "$ROOT/systemd/devops-backup.service" /etc/systemd/system/devops-stack-backup.service
install -m 0644 "$ROOT/systemd/devops-backup.timer" /etc/systemd/system/devops-stack-backup.timer
install -m 0644 "$ROOT/systemd/devops-update.service" /etc/systemd/system/devops-stack-update.service
install -m 0644 "$ROOT/systemd/devops-update.timer" /etc/systemd/system/devops-stack-update.timer
sed -i "s|__PROJECT_ROOT__|$ROOT|g" /etc/systemd/system/devops-stack-{backup,update}.service
systemctl daemon-reload
systemctl enable --now devops-stack-backup.timer devops-stack-update.timer
echo 'Enabled daily backups and weekly updates.'

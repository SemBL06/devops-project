#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] || { echo 'Missing .env' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Refusing update: working tree has uncommitted changes.' >&2; exit 1; }
./scripts/backup.sh
git pull --ff-only
docker compose pull
docker compose up -d --build --remove-orphans --wait --wait-timeout 300

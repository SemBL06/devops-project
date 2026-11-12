#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] || { echo 'Missing .env' >&2; exit 1; }
set -a
# shellcheck disable=SC1091
source .env
set +a
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT/backups}"
RCLONE_REMOTE="${RCLONE_REMOTE:?Set RCLONE_REMOTE in .env}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/rclone/rclone.conf}"
BACKUP_DAILY_KEEP="${BACKUP_DAILY_KEEP:-30}"
BACKUP_MONTHLY_KEEP="${BACKUP_MONTHLY_KEEP:-12}"
[[ -d "$BACKUP_ROOT" ]] || { echo "Backup path does not exist: $BACKUP_ROOT" >&2; exit 1; }
if [[ -n "${BACKUP_MOUNT:-}" ]]; then
  mountpoint -q "$BACKUP_MOUNT" || { echo "Optional backup disk is configured at $BACKUP_MOUNT but is not mounted" >&2; exit 1; }
  case "${BACKUP_ROOT%/}/" in
    "${BACKUP_MOUNT%/}/"*) ;;
    *) echo 'When BACKUP_MOUNT is set, BACKUP_ROOT must be located inside it' >&2; exit 1 ;;
  esac
fi
[[ -r "$RCLONE_CONFIG" ]] || { echo "Rclone config is not readable: $RCLONE_CONFIG" >&2; exit 1; }
export RCLONE_CONFIG
command -v rclone >/dev/null || { echo 'rclone is not installed' >&2; exit 1; }
mkdir -p "$BACKUP_ROOT"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot="$BACKUP_ROOT/$timestamp"
mkdir -m 700 "$snapshot"
trap 'rm -rf "$snapshot"' ERR
docker compose exec -T authentik-db pg_dump -U authentik -d authentik | gzip -1 > "$snapshot/authentik-postgres.sql.gz"
docker compose exec -T linkwarden-db pg_dump -U postgres -d postgres | gzip -1 > "$snapshot/linkwarden-postgres.sql.gz"
docker compose exec -T wordpress-db sh -lc 'mariadb-dump --single-transaction --routines --events -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' | gzip -1 > "$snapshot/wordpress-mariadb.sql.gz"
tar -czf "$snapshot/project-and-data.tar.gz" \
  --exclude='./.git' --exclude='./backups' \
  --exclude='./data/authentik/postgres' \
  --exclude='./data/linkwarden/postgres' \
  --exclude='./data/wordpress/database' \
  -C "$ROOT" .
git rev-parse HEAD > "$snapshot/git-commit.txt" 2>/dev/null || echo unknown > "$snapshot/git-commit.txt"
date -u +%FT%TZ > "$snapshot/created-utc.txt"
rclone copy "$snapshot" "$RCLONE_REMOTE/$timestamp" --create-empty-src-dirs
mapfile -t ids < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' | sort -r)
declare -A keep=()
for ((i=0; i<${#ids[@]} && i<BACKUP_DAILY_KEEP; i++)); do keep["${ids[$i]}"]=1; done
months=0
last_month=''
for id in "${ids[@]}"; do
  month="${id:0:6}"
  if [[ "$month" != "$last_month" && $months -lt $BACKUP_MONTHLY_KEEP ]]; then
    keep["$id"]=1
    last_month="$month"
    ((months+=1))
  fi
done
for id in "${ids[@]}"; do
  if [[ -z "${keep[$id]:-}" ]]; then
    rm -rf -- "$BACKUP_ROOT/$id"
    rclone purge "$RCLONE_REMOTE/$id" || true
  fi
done
trap - ERR
printf 'Backup %s saved locally and copied to %s/%s\n' "$timestamp" "$RCLONE_REMOTE" "$timestamp"

#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
usage() { echo "Usage: $0 <backup-id> [--remote]" >&2; exit 2; }
[[ $# -ge 1 && $# -le 2 ]] || usage
backup_id="$1"
[[ "$backup_id" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || usage
use_remote="${2:-}"
[[ -z "$use_remote" || "$use_remote" == --remote ]] || usage
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/backups/devops-stack}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/rclone/rclone.conf}"
RCLONE_REMOTE="${RCLONE_REMOTE:-encrypted-remote:devops-stack}"
export RCLONE_CONFIG
source_dir="$BACKUP_ROOT/$backup_id"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
if [[ "$use_remote" == --remote || ! -d "$source_dir" ]]; then
  command -v rclone >/dev/null || { echo 'rclone is required to fetch this backup' >&2; exit 1; }
  mkdir -p "$work/snapshot"
  rclone copy "$RCLONE_REMOTE/$backup_id" "$work/snapshot"
  source_dir="$work/snapshot"
fi
for file in authentik-postgres.sql.gz linkwarden-postgres.sql.gz wordpress-mariadb.sql.gz project-and-data.tar.gz; do
  [[ -s "$source_dir/$file" ]] || { echo "Backup is incomplete: missing $file" >&2; exit 1; }
done
gzip -t "$source_dir/authentik-postgres.sql.gz"
gzip -t "$source_dir/linkwarden-postgres.sql.gz"
gzip -t "$source_dir/wordpress-mariadb.sql.gz"
tar -tzf "$source_dir/project-and-data.tar.gz" >/dev/null
mkdir -p "$work/payload"
tar -xzf "$source_dir/project-and-data.tar.gz" -C "$work/payload"
[[ -f "$work/payload/.env" && -f "$work/payload/compose.yaml" ]] || { echo 'Backup is missing deployment configuration.' >&2; exit 1; }
echo "Restoring backup $backup_id. The running stack and its persisted data will be replaced."
if docker compose ps --status running -q 2>/dev/null | grep -q .; then ./scripts/backup.sh; fi
docker compose down --remove-orphans || true
cp -a "$work/payload/." "$ROOT/"
rm -rf data
if [[ -d "$work/payload/data" ]]; then cp -a "$work/payload/data" "$ROOT/data"; fi
[[ -f .env ]] || { echo 'Restored backup has no .env' >&2; exit 1; }
set -a
# shellcheck disable=SC1091
source .env
set +a
rm -rf data/authentik/postgres data/linkwarden/postgres data/wordpress/database
mkdir -p data/authentik/postgres data/linkwarden/postgres data/wordpress/database
docker compose up -d authentik-db linkwarden-db wordpress-db
for service in authentik-db linkwarden-db wordpress-db; do
  state=''
  for attempt in {1..60}; do
    container="$(docker compose ps -q "$service")"
    state="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
    [[ "$state" == healthy ]] && break
    sleep 2
  done
  [[ "$state" == healthy ]] || { echo "$service did not become healthy" >&2; exit 1; }
done
gzip -dc "$source_dir/authentik-postgres.sql.gz" | docker compose exec -T authentik-db psql -v ON_ERROR_STOP=1 -U authentik -d authentik
gzip -dc "$source_dir/linkwarden-postgres.sql.gz" | docker compose exec -T linkwarden-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres
gzip -dc "$source_dir/wordpress-mariadb.sql.gz" | docker compose exec -T wordpress-db sh -lc 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"'
docker compose up -d --build --remove-orphans --wait --wait-timeout 300
printf 'Recovery completed from backup %s.\n' "$backup_id"

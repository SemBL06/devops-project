#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { printf 'bootstrap: %s\n' "$*" >&2; exit 1; }
[[ -f .env ]] || fail 'Missing .env. Copy .env.example to .env and fill its required values first.'
set -a
# shellcheck disable=SC1091
source .env
set +a
required_vars=(PROJECT_DOMAIN ACME_EMAIL CF_DNS_API_TOKEN DDNS_PUID DDNS_PGID CF_DDNS_API_TOKEN CF_ZONE_ID CF_RECORD_NAME AUTHENTIK_SECRET_KEY AUTHENTIK_POSTGRES_PASSWORD LINKWARDEN_POSTGRES_PASSWORD LINKWARDEN_NEXTAUTH_SECRET LINKWARDEN_MEILI_MASTER_KEY WORDPRESS_DB_PASSWORD WORDPRESS_DB_ROOT_PASSWORD BACKUP_ROOT RCLONE_CONFIG RCLONE_REMOTE)
for name in "${required_vars[@]}"; do
  value="${!name:-}"
  [[ -n "$value" && "$value" != required && "$value" != *CHANGE_ME* ]] || fail "Set $name in .env before deploying."
done
for name in DDNS_PUID DDNS_PGID; do
  [[ "${!name}" =~ ^[0-9]+$ ]] || fail "$name must be a numeric user or group ID."
done
if [[ ! -s data/authentik/postgres/PG_VERSION ]]; then
  for name in AUTHENTIK_BOOTSTRAP_EMAIL AUTHENTIK_BOOTSTRAP_PASSWORD; do
    value="${!name:-}"
    [[ -n "$value" && "$value" != required && "$value" != *CHANGE_ME* ]] || fail "Set $name in .env for Authentik's first start."
  done
fi
command -v docker >/dev/null || fail 'Docker is not installed.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose plugin is not available.'
command -v rclone >/dev/null || fail 'Install and configure rclone before deployment.'
[[ -r "$RCLONE_CONFIG" ]] || fail "Rclone config is not readable at $RCLONE_CONFIG."
if [[ -n "${BACKUP_MOUNT:-}" ]]; then
  mountpoint -q "$BACKUP_MOUNT" || fail "Optional backup disk is configured at $BACKUP_MOUNT but is not mounted. Mount it or clear BACKUP_MOUNT."
  case "${BACKUP_ROOT%/}/" in
    "${BACKUP_MOUNT%/}/"*) ;;
    *) fail "When BACKUP_MOUNT is set, BACKUP_ROOT must be located inside it." ;;
  esac
fi
export RCLONE_CONFIG
remote_name="${RCLONE_REMOTE%%:*}"
rclone listremotes | grep -Fxq "${remote_name}:" || fail "Rclone remote ${remote_name}: is not configured."
rclone config show "$remote_name" | grep -Fxq 'type = crypt' || fail "Rclone remote ${remote_name}: must be a crypt remote."
docker compose --env-file .env config --quiet || fail 'Compose configuration is invalid.'
mkdir -p data/traefik data/cloudflare-ddns data/authentik/{postgres,media,certs,custom-templates} data/wordpress/{database,html} data/uptime-kuma data/linkwarden/{postgres,meilisearch,storage} "$BACKUP_ROOT"
chmod 700 data data/traefik "$BACKUP_ROOT"
chmod 600 .env
docker compose --env-file .env up -d --build --remove-orphans --wait --wait-timeout 300
printf '\nStack is running. Open https://architecture.%s for service and setup instructions.\n' "$PROJECT_DOMAIN"
printf 'Install daily backup and weekly update timers with: sudo ./scripts/install-timers.sh\n'

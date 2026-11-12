# DevOps self-hostingproject

Deze projectroot is de Git-root en de deploymentroot. De WiGLE CSV Viewer staat onder `apps/wiggleviewer/`; alle services draaien via de hoofd-`compose.yaml`.

## Services

- Traefik reverse proxy met Let’s Encrypt DNS-01 via Cloudflare
- Cloudflare DDNS-updater voor het wildcard-A-record, zodat wisselende thuis-IP-adressen worden bijgewerkt
- Authentik identity provider
- WiGLE CSV Viewer, WordPress/MariaDB, Uptime Kuma, Linkwarden/PostgreSQL/Meilisearch en Excalidraw
- Eigen statische architectuurpagina onder `site/`

Alle apps gebruiken `app.devops.forageek.com`. Zie [README.md](README.md) voor Cloudflare-records, installatiestappen, authentik-configuratie en beheer.

## Beheer

- Start: `./scripts/bootstrap.sh`
- Back-up: `./scripts/backup.sh`
- Herstel: `./scripts/recover.sh <backup-id>`
- Update: `./scripts/update.sh`
- Systemd schema’s: `sudo ./scripts/install-timers.sh`

# DevOps self-hostingstack

Eén Docker Compose-project voor een Ubuntu-thuisserver met `forageek.com`. De WiGLE CSV Viewer is onderdeel van de stack onder `apps/wiggleviewer/`.

## Services

Traefik, Authentik, WiGLE CSV Viewer, WordPress/MariaDB, Uptime Kuma, Linkwarden/PostgreSQL/Meilisearch, Excalidraw en de eigen statische architectuurpagina.

Alle applicaties krijgen een subdomein van de vorm `appName.devops.forageek.com`. De Cloudflare DDNS-container werkt het wildcard-A-record bij als je thuis-IP verandert. Traefik gebruikt Let’s Encrypt DNS-01; de DNS-records staan op DNS-only. De gedetailleerde Cloudflare-stappen, port-forwarding, configuratievelden, Authentik-inrichting en beheer staan in [DEPLOYMENT.md](DEPLOYMENT.md).

## Snel starten

Vul eerst `.env` in en controleer dat rclone beschikbaar is. Een aparte back-upschijf is optioneel: standaard staan lokale snapshots onder `./backups` en worden ze naar de ingestelde rclone-remote gekopieerd.

## Beheer

- Dagelijkse back-up: `./scripts/backup.sh`
- Herstel vanaf snapshot: `./scripts/recover.sh <backup-id>`
- Updates: `./scripts/update.sh`
- Systemd timers installeren: `sudo ./scripts/install-timers.sh`

De stackconfiguratie staat in `compose.yaml`. Gebruik `docker compose down` om te stoppen; `docker compose down -v` verwijdert persistente volumes.

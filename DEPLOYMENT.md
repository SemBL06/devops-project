# DevOps self-hostingstack

De projectroot bevat één Docker Compose-stack voor Ubuntu: Traefik, Authentik, WiGLE CSV Viewer, WordPress/MariaDB, Uptime Kuma, Linkwarden/PostgreSQL/Meilisearch, Excalidraw en deze statische architectuurpagina.

## Cloudflare vooraf instellen

De app-adressen zijn `architecture`, `wigle`, `wordpress`, `uptime`, `linkwarden`, `excalidraw` en `authentik`, allemaal onder `devops.forageek.com`.

1. Maak een Cloudflare API-token voor Traefik met `Zone / DNS / Edit` en `Zone / Zone / Read`, beperkt tot zone `forageek.com`; zet dit in `CF_DNS_API_TOKEN`.
2. Maak daarnaast een afzonderlijke token voor de DDNS-container met dezelfde beperkte zone-rechten. Zet deze in `CF_DDNS_API_TOKEN` en de Zone ID uit het domeinoverzicht in `CF_ZONE_ID`.
3. Maak één `A`-record met naam `*.devops`, initieel naar je huidige publieke IPv4-adres. Zet het op **DNS only** (grijze wolk). Verwijder eventuele losse app-A-records, want die overschrijven het wildcard-record. De DDNS-container vereist een bestaand record en werkt het meteen bij start en daarna elke vijf minuten bij. `CF_RECORD_NAME` kan het record aanpassen.
4. Zet `DDNS_PUID` en `DDNS_PGID` in `.env` op de UID/GID van de Linux-gebruiker die de projectdata-map bezit (controleer met `id -u` en `id -g`). Optioneel kan `DISCORD_URI` een Discord webhook bevatten voor meldingen.
5. Reserveer in je router een vast LAN-adres voor de Ubuntu-server en forward TCP 80 en 443 naar dat adres. Sta op de server alleen die publieke poorten toe en beperk SSH tot je beheer-IP. DDNS lost CGNAT niet op: je internetverbinding moet inkomend verkeer naar je publieke IPv4 kunnen ontvangen. DNS-only maakt het thuis-IP zichtbaar in DNS.
6. Configureer rclone crypt voor Google Drive. Een aparte back-upschijf is optioneel: standaard worden lokale snapshots onder `./backups` opgeslagen en daarna met rclone gekopieerd. Wil je toch een aparte schijf, mount die persistent (bijvoorbeeld via `/etc/fstab`), zet `BACKUP_MOUNT` op het mountpoint en `BACKUP_ROOT` op een map daarbinnen.

Deze hostnamen hebben twee labels vóór `forageek.com`. Cloudflare Universal SSL dekt diepere labels niet in een normale full-zone setup. Daarom staan de DNS-records op DNS-only en levert Traefik een Let’s Encrypt wildcardcertificaat via Cloudflare DNS-01. Daarvoor is de Cloudflare API-token nodig; de challenge vereist geen publiek bereikbare HTTP-route.[Cloudflare SSL-beperkingen](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/) · [Traefik DNS-01](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/)

## Eenmalige installatie op Ubuntu

Vereist: Docker Engine met Compose-plugin 2.17 of hoger, Git, `rclone`, `gzip` en `tar`. Clone deze repository naar bijvoorbeeld `/opt/devops-stack`.

```bash
cd /opt/devops-stack
cp .env.example .env
nano .env
```

Vul alle `required` velden in `.env` vooraf in. Gebruik unieke waarden voor elke database en app-secret; `openssl rand -hex 32` maakt een geschikte willekeurige waarde. De bootstrap vraagt geen e-mailadressen of app-wachtwoorden. `.env` wordt genegeerd door Git en door het script op modus `600` gezet. Zet voor DDNS `DDNS_PUID`/`DDNS_PGID` op de eigenaar van de projectmap en laat `DISCORD_URI` leeg als je geen meldingen wilt.

Start alle containers met één commando:

```bash
./scripts/bootstrap.sh
```

De bootstrap controleert Docker Compose, verplichte configuratie en de rclone-remote. Als `BACKUP_MOUNT` is ingevuld, controleert hij ook dat die schijf gemount is en dat `BACKUP_ROOT` erop staat. Daarna valideert hij de Compose-configuratie en bouwt/start hij de stack.

## Eerste app-configuratie

- **Authentik**: `AUTHENTIK_BOOTSTRAP_EMAIL` en `AUTHENTIK_BOOTSTRAP_PASSWORD` leveren bij eerste start het `akadmin`-account. Verwijder de bootstrap-password uit `.env` nadat de eerste login is gelukt; de bootstrap vereist die alleen zolang Authentik nog geen database heeft. Maak daarna een gebruiker/groep en een Proxy Provider in modus **Forward auth (domain level)**, met als externe host `https://authentik.devops.forageek.com`. Koppel de provider aan de embedded outpost. De Traefik-middleware beveiligt WiGLE, WordPress, Uptime Kuma, Linkwarden en Excalidraw. De middlewareconfiguratie staat in `traefik/dynamic/authentik.yml`.
- **Authentik**: `AUTHENTIK_BOOTSTRAP_EMAIL` en `AUTHENTIK_BOOTSTRAP_PASSWORD` leveren bij eerste start het `akadmin`-account. Verwijder de bootstrap-password uit `.env` nadat de eerste login is gelukt; de bootstrap vereist die alleen zolang Authentik nog geen database heeft. Maak daarna een gebruiker/groep en een Proxy Provider in modus **Forward auth (domain level)**, met als externe host `https://authentik.devops.forageek.com`. Maak een Authentik Application voor deze provider en koppel die aan de embedded outpost. De Traefik-middleware beveiligt WiGLE, WordPress, Uptime Kuma, Linkwarden en Excalidraw. De middlewareconfiguratie staat in `traefik/dynamic/authentik.yml`.
- **Linkwarden OIDC**: maak in Authentik een OAuth2/OIDC-provider met slug `linkwarden` en redirect URI `https://linkwarden.devops.forageek.com/api/v1/auth/callback/oidc`; maak er een Application voor. Stel in `.env` de client-ID, client-secret en `LINKWARDEN_OIDC_ENABLED=true` in; herstart met `docker compose up -d linkwarden`. De issuer in Linkwarden is `https://authentik.devops.forageek.com/application/o/linkwarden` zonder afsluitende slash. Het eerste Linkwarden-account wordt beheerder, dus maak het eerste account zelf via OIDC nadat Authentik is ingesteld.
- **WordPress**: open de hostname en voltooi de WordPress-installatie. WordPress heeft eigen accountauthenticatie; de database staat alleen op het interne Compose-netwerk.
- **Uptime Kuma**: maak de beheerder aan bij de eerste opening. De opslag gebruikt een lokale volume-map, geschikt voor SQLite-locking.
- **WiGLE**: CSV-bestanden worden door de browser verwerkt en niet naar de server opgeslagen.
- **Cloudflare DDNS**: controleer logs met `docker compose logs -f cloudflare-ddns`. De container werkt alleen het bestaande wildcard-A-record bij. Voeg geen AAAA-record toe tenzij je IPv6 afzonderlijk configureert.
- **Excalidraw**: de self-hosted image is een editor; delen, samenwerking en serveropslag zijn niet beschikbaar. Exporteer tekeningen vanuit de browser.

Authentik forward auth voor de apps werkt nadat de Forward Auth-provider/outpost in Authentik is aangemaakt. Authentik ondersteunt domain-level forward auth voor meerdere apps onder hetzelfde hoofddomein.[Authentik Forward Auth](https://docs.goauthentik.io/add-secure-apps/providers/proxy/) Linkwarden gebruikt daarnaast native OIDC zodra de providergegevens in `.env` zijn ingevuld. WordPress behoudt de eigen WordPress-login achter de centrale Authentik-toegang.

## Back-ups, herstel en updates

De dagelijkse back-up bewaart PostgreSQL- en MariaDB-dumps, overige persistente data, deploymentbestanden en `.env` lokaal onder `BACKUP_ROOT` (standaard `./backups`) en kopieert de snapshot via rclone naar de crypt-remote. Een aparte schijf is optioneel. Als `BACKUP_MOUNT` wel is ingesteld, stopt het script veilig wanneer die schijf niet gemount is. Standaardretentie is 30 dagelijkse en 12 maandelijkse snapshots.

```bash
./scripts/backup.sh
./scripts/recover.sh 20261111T040000Z
./scripts/recover.sh 20261111T040000Z --remote
./scripts/update.sh
```

Recovery vereist een exact snapshot-ID uit de map `BACKUP_ROOT`. Bij herstel vanuit rclone geef je `--remote` op of gebruik je het als de lokale snapshot ontbreekt. Herstel stopt de stack, vervangt persistentie, importeert alle database-dumps, start Compose opnieuw en wacht op healthchecks. Als een stack draait, maakt recovery eerst een veiligheidsback-up. De huidige data wordt vervangen door de gekozen snapshot.

Installeer automatische schema’s eenmalig met rootrechten:

```bash
sudo ./scripts/install-timers.sh
```

Dat zet een dagelijkse back-uptimer en wekelijkse update op zondag 04:00 UTC. Updates maken eerst een back-up, weigeren een Git-werkboom met lokale wijzigingen, halen Git en images op en herstarten de Compose-stack. Controleer resultaten met `systemctl list-timers 'devops-stack-*'` en `journalctl -u devops-stack-backup.service -u devops-stack-update.service`.

## Handige beheercommando’s

```bash
docker compose ps
docker compose logs -f
docker compose pull
docker compose up -d --build
```

Gebruik `docker compose down` om te stoppen. Gebruik geen `docker compose down -v`: daarmee zouden persistente data-volumes verwijderd worden.

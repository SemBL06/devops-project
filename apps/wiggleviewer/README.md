# WiGLE CSV Viewer

Local web app to browse WiGLE CSV files with filters, uniqueness toggles, ignored columns, row counts, table preview, and CSV export.

## Run

```powershell
node .\server.js
```

Then open `http://localhost:5173`.

## Docker Compose

The root `compose.yaml` builds this app from `apps/wiggleviewer/` and routes it through Traefik. From the project root, start the full stack with `./scripts/bootstrap.sh`.

## Upload

The app loads CSV files selected in the browser. Files are parsed locally and are not saved by the server.

When running behind a trusted HTTPS reverse proxy, set `TRUST_PROXY=1` so rate limiting uses the visitor IP from `X-Forwarded-For`.

Notes:

- `TRUST_PROXY` should only be enabled when the app is behind a trusted reverse proxy that sets `X-Forwarded-For`.
- Do not commit real `.env` values to source control.

## Upload Security

- Browser upload is validated to allow only `.csv`.
- Upload size cap is `25 MB`.
- The uploaded file is parsed client-side (not saved server-side by this app).
- CSV must contain core WiGLE-like columns: `MAC/BSSID`, `SSID`, `Latitude`, and `Longitude` (common header aliases are accepted).
- CSV hardening limits:
  - max `256` columns
  - max `300000` rows
  - max `10000` characters per cell
- Export hardening: cells starting with `=`, `+`, `-`, `@` are prefixed to mitigate CSV formula injection.
- Regex filter hardening:
  - max regex length `256` characters
  - disabled for datasets larger than `50000` rows

## Features

- Upload one CSV manually in the browser.
- Add multiple filters (`contains`, `equals`, `starts with`, `ends with`, `regex`, `empty`, `not empty`).
- Protocol/type toggles (`WiFi`, `BLE/BT`, `LTE`) and tag chips for WiFi/BLE auth modes.
- Uniqueness toggles:
  - `Unique by MAC`
  - `Unique by WiFi (SSID)`
  - Both together = uniqueness by the `(MAC, SSID)` combination.
- Ignore columns before preview/export.
- Result count shown in UI (`filtered / total`).
- Browser table preview with configurable rows per page and pagination.
- Download filtered CSV output.
- Security hardening headers + basic API rate limiting.

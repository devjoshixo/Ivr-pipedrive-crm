# Deployment Guide — IVRSolutions for Pipedrive

The app is config-only to deploy (no code changes for your domain). Two ways: Docker
Compose (simplest) or bare Node. **Requires PostgreSQL** (14+).

Replace `<DOMAIN>` with your production HTTPS domain, e.g. `pipedrive.founderscart.com`.

---

## 1. Environment variables
Copy `.env.example` → `.env` and set:

| Var | Production value |
|---|---|
| `DATABASE_URL` | `mysql://<user>:<pass>@<host>:3306/<db>` — your **production MariaDB/MySQL** (URL-encode special chars in the password) |
| `DB_TABLE_PREFIX` | `pipedrive_` when sharing a database with other apps (keeps this app's tables namespaced); empty for a dedicated DB |
| `IVR_TOKEN_ENC_KEY` | 32-byte hex (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) — **keep stable**; rotating it invalidates stored IVR tokens |
| `PIPEDRIVE_CLIENT_ID` / `PIPEDRIVE_CLIENT_SECRET` | from the Pipedrive Developer Hub app |
| `PIPEDRIVE_REDIRECT_URI` | `https://<DOMAIN>/oauth/callback` (must match Dev Hub exactly) |
| `OAUTH_STATE_SECRET` | random string |
| `IVR_BASE_URL` | `https://api.ivrsolutions.in` |
| `SYNC_INTERVAL_MS` | `30000` (or as desired, floor 10000) |
| `NO_MATCH_POLICY` | `lead` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `120` / `60000` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

## 2a. Deploy with Docker Compose (uses a bundled MariaDB)
```bash
cp .env.example .env   # fill the values above
docker compose up -d   # starts MariaDB + app; app waits for DB, migrates, then serves
```
To use your **existing managed MariaDB/MySQL** instead of the bundled one: remove the `mariadb`
service + `depends_on` from `docker-compose.yml`, and set `DATABASE_URL` to your managed DB.

## 2b. Deploy with bare Node
```bash
npm ci --omit=dev
npm run migrate        # applies schema.sql to DATABASE_URL (idempotent)
node backend/src/server.js   # or run under pm2/systemd
```

## 3. TLS / reverse proxy
Put the app behind nginx/Caddy terminating HTTPS for `<DOMAIN>` → proxy to `127.0.0.1:3000`.
Pipedrive requires HTTPS for OAuth + iframes. (Caddy example: `<DOMAIN> { reverse_proxy 127.0.0.1:3000 }`.)

## 4. Update the Pipedrive Developer Hub (point everything at <DOMAIN>)
- **OAuth callback URL:** `https://<DOMAIN>/oauth/callback`  (and the uninstall DELETE hits the same URL)
- **App extensions → URLs:**
  - Floating window (softphone): `https://<DOMAIN>/softphone-host.html`
  - App settings page:          `https://<DOMAIN>/settings.html`
  - Custom panel (Person):      `https://<DOMAIN>/panel.html`
- Scopes: users:read, contacts:read, contacts:full, deals:read, leads:full, activities:full, phone-integration
- After changing scopes/URLs, **reinstall** the app in the test company.

## 5. Post-deploy smoke test
```bash
curl https://<DOMAIN>/api/healthz                 # -> {"status":"ok"...}
curl https://<DOMAIN>/settings.html -I            # -> 200
```
Then in Pipedrive: open Settings → paste IVR token → Save; open the softphone; place a
test call; confirm a call log appears.

## Notes
- The schema targets **MariaDB 10.6+ / MySQL 8+**. Works on shared hosting MySQL
  (e.g. Hostinger), RDS/Aurora MySQL, PlanetScale, or your own MariaDB.
- Set `DB_TABLE_PREFIX` (e.g. `pipedrive_`) when the database is shared with other
  apps; the migration only creates its own prefixed tables and never touches others.
- `npm run migrate` is safe to re-run (all `CREATE TABLE IF NOT EXISTS` / idempotent).
- Scheduler + rate limiter are in-process (single instance) — run **one** app instance
  (multi-instance was intentionally out of scope).
- Back up the DB; it holds the sealed IVR tokens + OAuth refresh tokens (encrypted).

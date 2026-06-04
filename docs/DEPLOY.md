# Deployment Guide — IVRSolutions for Pipedrive

The app is config-only to deploy (no code changes for your domain). Two ways: Docker
Compose (simplest) or bare Node. **Requires PostgreSQL** (14+).

Replace `<DOMAIN>` with your production HTTPS domain, e.g. `pipedrive.founderscart.com`.

---

## 1. Environment variables
Copy `.env.example` → `.env` and set:

| Var | Production value |
|---|---|
| `DATABASE_URL` | `postgres://<user>:<pass>@<host>:5432/<db>` — your **production Postgres** |
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

## 2a. Deploy with Docker Compose (uses a bundled Postgres)
```bash
cp .env.example .env   # fill the values above
docker compose up -d   # starts Postgres + app; app waits for DB, migrates, then serves
```
To use your **existing managed Postgres** instead of the bundled one: remove the `postgres`
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
- The schema is **Postgres-only**. Managed options: RDS/Aurora Postgres, Supabase, Neon,
  DigitalOcean Managed PG, Hostinger/your own Postgres.
- `npm run migrate` is safe to re-run (all `CREATE TABLE IF NOT EXISTS` / idempotent).
- Scheduler + rate limiter are in-process (single instance) — run **one** app instance
  (multi-instance was intentionally out of scope).
- Back up the DB; it holds the sealed IVR tokens + OAuth refresh tokens (encrypted).

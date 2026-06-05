# IVRSolutions for Pipedrive

CTI integration that embeds the IVRSolutions WebRTC softphone into Pipedrive CRM:
click-to-dial, inbound screen-pop, automatic call logging, and a 15-minute historical
sync. Sibling of the company's Zoho extension and Salesforce AppExchange package.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for decisions, the Pipedrive platform facts
(2025-2026), and the call-log model.

## Status

**Milestone 1 — IVR token validation slice (done).** Settings page → backend proxy →
`POST /api/key_authentication` → green check. Token sealed (AES-256-GCM) in MariaDB/MySQL.

**Milestone 2 — Pipedrive OAuth (done).** Authorization-code flow with signed-state CSRF
protection and transparent refresh-token rotation (60-day sliding expiry):

- `GET /oauth/install` → redirects to `oauth.pipedrive.com/oauth/authorize`.
- `GET /oauth/callback` → exchanges the code, resolves the company via `users/me`,
  stores tokens, and lands the admin on `settings.html?company_id=…`.
- `tokenService.getAccessToken(companyId)` returns a valid access token, refreshing
  against `api_domain` when expired (used by all later REST calls).

**Milestone 3 — Floating-window softphone embed + SDK bridge (done).** Includes click-to-dial
and the screen-pop backend:

- `frontend/softphone-host.html` + `frontend/js/softphone-host.js` — the Custom Floating
  Window: initialises the App Extensions SDK, embeds the CDN softphone (mic/autoplay),
  bridges postMessage both ways. `Event.VISIBILITY` context → `IVR_DIAL` (click-to-dial);
  inbound → `SHOW_FLOATING_WINDOW` + focus mode + screen-pop.
- `GET /api/cti/lookup?number=` — finds the matching person by phone. Authenticated with the
  SDK's signed JWT (`GET_SIGNED_TOKEN`); company taken from the verified token, not the query.
- `backend/src/phone.js` — phone normalization + variant generation (shared with the sync).
- `backend/src/pipedrive/persons.js` — `searchPersonByPhone` (tries variants, stops at first hit).
- `backend/src/pipedrive/jwt.js` — HS256 verification of SDK signed tokens.

In-product verification items (need the registered app): floating-window mic/autoplay policy,
exact `REDIRECT_TO`/`SET_FOCUS_MODE` payloads, and the VISIBILITY context field carrying the number.

**Milestone 7 — 15-minute historical sync (done).** The "killer feature": a scheduled pull
from `POST /v1/all_call_logs` that backfills missed calls, idempotent via app-side dedupe.

- `backend/src/ivr/callLog.js` — normalize the 3-category response (direction + dedupe key).
- `backend/src/sync/callLogPayload.js` — build the Pipedrive `callLogs` payload (UTC times,
  outcome, recording URL + PBX id in the HTML note).
- `backend/src/pipedrive/callLogs.js` — `POST /v1/callLogs` client.
- `backend/src/db/syncStore.js` — cursors (`sync_state`) + dedupe ledger (`synced_calls`).
- `backend/src/sync/runSync.js` — per-company orchestrator: fetch → dedupe → match person
  (cached per run) → create call log → advance cursors → saturation warning at the 20-cap.
- `backend/src/sync/scheduler.js` — 15-min cadence over all connected companies.
- `GET /api/sync/status` + `POST /api/sync/run` — for the setup dashboard (SDK-JWT auth).

Verified live end-to-end against the real IVR API + MariaDB (Pipedrive push stubbed):
first run created 60 call logs across all 3 categories and fired the saturation warning;
second run deduped to 0 with cursors advanced.

**Milestone 6 — Real-time logging + recording reconciliation (done).**

- `frontend/js/pipedrive-cti-adapter.js` emits `IVR_CALL_ENDED` (number, direction, SIP id,
  duration) on call end; the floating-window host POSTs it to `POST /api/calls`.
- `backend/src/routes/calls.js` — `POST /api/calls` creates the call log immediately, keyed in
  `synced_calls` by `rt-<sipCallId>` with `source='realtime'`.
- **No duplicates:** the 15-min sync matches a record's `sip_call_id` against real-time rows
  (`syncStore.getRealtimeBySip`) and, instead of creating a second log, **attaches the recording**
  to the existing one (`pipedrive/recordings.js`: download .wav → multipart
  `POST /callLogs/{id}/recordings`). Sync-created logs get their recording attached too.

**Milestone 8 — Setup dashboard + recording player (done).**

- `frontend/dashboard.html` + `js/dashboard.js` — Settings UI: last sync, last error, cursors,
  and a "Run sync now" button (consumes `/api/sync/status` + `/api/sync/run`).
- `frontend/panel.html` + `js/panel.js` — Custom Panel: plays recent call recordings for the
  current person (`GET /api/calls/recent`).

All milestones (1–8) are now built and tested. What remains is **registering the app + going
live** (see "Going live" below) — no further code is required to connect.

### Going live (the only remaining steps — your actions)

1. Register a **private app** in the Pipedrive Developer Hub; declare OAuth callback + scopes,
   the Custom Floating Window (`softphone-host.html`), Custom Panel (`panel.html`), and Settings
   UI (`settings.html` / `dashboard.html`). Put the credentials in `.env`.
2. Expose the backend over **public HTTPS** (a `cloudflared`/`ngrok` tunnel for dev, or a deploy).
3. Ensure the CDN softphone sends `CSP: frame-ancestors *.pipedrive.com` and the recording host
   allows `<audio>` embedding in the panel iframe.
4. Visit `/oauth/install`, approve → company connected → `POST /api/sync/run` writes real call
   logs; click-to-dial, screen-pop, and the panel player go live.

In-product verification items remain (SDK payload shapes, iframe mic/autoplay policy, panel
record-id param) — marked `TODO(verify in-product)` in the frontend modules.

### Set up Pipedrive OAuth (to test the live flow)

1. Register a **private app** in the Pipedrive Developer Hub; set the callback URL to
   `http://localhost:3000/oauth/callback` and request scopes `users:read`, `contacts:read`,
   `deals:read`, `activities:full`, `phone-integration`.
2. Put `PIPEDRIVE_CLIENT_ID`, `PIPEDRIVE_CLIENT_SECRET`, `PIPEDRIVE_REDIRECT_URI` in `.env`.
3. `npm run dev`, then open `http://localhost:3000/oauth/install` and approve. You'll be
   redirected back to the settings page with your company connected.

## Layout

```
backend/   Node.js + Express + MariaDB/MySQL API (OAuth, IVR proxy, sync cron)
frontend/  Pipedrive Custom UI iframes (settings, floating-window softphone host, panel)
```

## Develop

```bash
cp .env.example .env          # then fill DATABASE_URL + IVR_TOKEN_ENC_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # -> IVR_TOKEN_ENC_KEY
npm install
npm run migrate               # apply backend/src/db/schema.sql
npm run dev                   # http://localhost:3000
```

Open `http://localhost:3000/settings.html`, paste the IVR API token, click **Validate**.

## Test

```bash
npm test                      # node:test, no external deps required
```

Current coverage: AES-256-GCM token sealing (`crypto.js`) and the IVR API client
(`ivr/client.js` — validate / all_call_logs / c2c) with injected fetch.

## Security notes

- The IVR token is validated/stored **server-side only**, sealed with AES-256-GCM
  (`IVR_TOKEN_ENC_KEY`). It never appears in iframe code or the app package.
- The settings iframe calls **our backend**, which proxies the IVR API — the browser
  never holds the token.
- Pipedrive custom fields can't enforce uniqueness, so call dedupe is app-side
  (`synced_calls` table, keyed on PBX `recordid`).

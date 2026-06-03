# IVRSolutions ↔ Pipedrive — Session Handoff

Read this to resume. The integration is **feature-complete, hardened, tested (148 passing),
deployed via ngrok, and connected to a live Pipedrive sandbox**. What's left is mostly
verification + go-live ops, not new feature code.

Repo: `git@github.com:devjoshixo/Ivr-pipedrive-crm.git` (branch `main`). Working tree clean,
last commit `8fb7da6`.

---

## Live runtime state (this machine)

| Thing | Value |
|---|---|
| ngrok (static) | `https://prepositional-scleroblastic-ahmed.ngrok-free.dev` → localhost:3000 |
| Backend | Node/Express on `:3000` (run detached) |
| Postgres | Docker `ivr-pg`, **host port 5433** (volume preserved; `.env` DATABASE_URL points here) |
| Connected company | `19733254` (devjoshi-sandbox, user 31751199 "Dev Joshi") |
| Pipedrive app | private app, client_id `bfcb7699e1b9e7ee` (secret in `.env`) |
| c2c mapping set | user 31751199 → DID `+918044475500`, ext **5105** |
| Secrets | all in `.env` (gitignored): IVR_TOKEN_ENC_KEY, PIPEDRIVE_CLIENT_ID/SECRET/REDIRECT_URI |

### Bring it back up after a reboot/sleep
```bash
cd /mnt/data/Code/Office/Pipedrive
docker start ivr-pg                                   # if stopped
setsid bash -c 'node backend/src/server.js > /tmp/ivr-srv.log 2>&1' </dev/null & disown
setsid bash -c 'ngrok http --url=https://prepositional-scleroblastic-ahmed.ngrok-free.dev 3000 > /tmp/ngrok.out 2>&1' </dev/null & disown
```
Env quirks: tool-spawned bg procs get SIGSTKFLT(exit144) — **detach with setsid**, kill by port
(`lsof -ti tcp:3000 | xargs kill`) NOT `pkill -f server.js` (matches own shell). ngrok local API
at localhost:4040. Mint a test SDK JWT to call the APIs:
```bash
node -e 'const c=require("crypto");const e=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=e({alg:"HS256",typ:"JWT"});const p=e({companyId:"19733254",userId:"31751199",exp:Math.floor(Date.now()/1000)+300});console.log(h+"."+p+"."+c.createHmac("sha256",process.env.PIPEDRIVE_CLIENT_SECRET).update(h+"."+p).digest("base64url"))'
```

---

## DONE & verified live (with real calls)
- OAuth connect + refresh + self-heal on 401
- IVR token validate/store (AES-256-GCM sealed)
- 30s sync: `/v1/all_call_logs` → Pipedrive call logs (cursor-paged, deduped, saturation warn)
- Person match → link; unknown caller → auto **Person + Lead** (noMatchPolicy=lead)
- Recording attach to native Call tab + recording-player panel
- Embedded softphone floating window (login + calls work); S/M/L resize; incoming banner
- **Click-to-call (c2c)** — verified end-to-end (call to +919910513597, logged as `c2c-740026`)
- Team API: per-company **API keys** (X-Api-Key) + **rate limiting** + **Zod validation**
- DID/extension→user mapping (page + folded into Settings)
- App **uninstall** cleanup (`DELETE /oauth/callback`) + **dark theme**
- Deploy: Dockerfile + docker-compose + CI (test/db-tests/docker-build). 148 tests + 5 DB tests.

## REMAINING

### 1. Last in-product verification
- [ ] **Inbound screen-pop** — call the DID from another phone; matching Person should open.
      Watch `/api/cti/lookup` in the logs. Fix `REDIRECT_TO` payload if the record doesn't open.

### 2. `TODO(verify in-product)` markers (finalize after the live tests)
- [ ] screen-pop `Command.REDIRECT_TO` payload to open ONE Person record (softphone-host.js)
- [ ] softphone WebRTC-dial context passing (the panel "Softphone" button) (softphone-host.js)
- [ ] panel record-id param (`personIdFromSearch`) (panel-context.mjs) — confirm Pipedrive's param name

### 3. UI decision
- [ ] **Dashboard reachability**: `dashboard.html` (sync status / stats / API key / run-sync) has no
      Pipedrive entry point. Recommend folding those sections into the Settings page (already
      reachable, already has token + mapping). Not yet done — awaiting go-ahead.

### 4. Optional feature (not decided)
- [ ] **Late-note back-fill**: notes typed after a call don't reach an already-logged call.
      Fix = softphone emits note-saved → backend updates the activity note (we store
      pd_call_log_id by sip_call_id). User hasn't said yes/no.

### 5. Dev Hub (user actions)
- [ ] Register **Custom Panel** (`/panel.html`, Person details) so the recording panel + Call
      button appear. Floating window + settings already registered.

### 6. Go public (decided: PUBLIC Marketplace)
See `docs/MARKETPLACE.md` (checklist, scope justification, listing copy, data-handling summary)
and `docs/PRIVACY.md` (privacy draft).
- [ ] Host off ngrok: stable HTTPS + managed Postgres (compose ready); update Dev Hub URLs.
- [ ] Real IVR token (not the dev test token).
- [ ] Listing assets: icon, 3–5 screenshots, support contact, ToS + pricing URLs, hosted privacy policy.
- [ ] Demo video + test account, then **Send to review** (Pipedrive ~1–3 wk), then publish.
- NOTE: multi-instance scaling intentionally **skipped** (single instance per user's decision).

## Key gotchas (don't relearn)
- **c2c DID format**: `c2c_get` rejects E.164 `+918044475500` ("Did No. Invalid"); needs
  `918044475500` (digits, keep country code, no `+`). Backend strips via `digitsOnly(did)`.
- CDN softphone iframe must be `…/softphone/index.html` (dir path 404s); framing not blocked.
- App Extensions SDK `+esm`: constructor is `default.default` — see the `typeof SDK==='function'` shim.
- Scope changes need **uninstall + reinstall** (re-auth alone keeps old scopes).
- `persons/search` works with `contacts:read`; create-person needs `contacts:full`; lead needs `leads:full`.
- Pipedrive call log `subject` is empty when fetched, but the linked **activity** has the title (fine).

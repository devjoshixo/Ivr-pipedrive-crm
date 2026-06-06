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
| Database | **Production MariaDB** (FoundersCart, `202.133.74.249:3306/founderscart`), tables prefixed `pipedrive_`. `.env` `DATABASE_URL` + `DB_TABLE_PREFIX=pipedrive_`. (Old local `ivr-pg` Postgres is retired.) |
| Connected company | `19733254` (devjoshi-sandbox, user 31751199 "Dev Joshi") |
| Pipedrive app | private app, client_id `bfcb7699e1b9e7ee` (secret in `.env`) |
| c2c mapping set | user 31751199 → DID `+918044475500`, ext **5105** |
| Secrets | all in `.env` (gitignored): IVR_TOKEN_ENC_KEY, PIPEDRIVE_CLIENT_ID/SECRET/REDIRECT_URI |

### Bring it back up after a reboot/sleep
```bash
cd /mnt/data/Code/Office/Pipedrive
# DB is the remote production MariaDB now (no local container to start)
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
- **Softphone = companion Chrome extension** (pivoted off the Pipedrive floating window, which
  can't arm for inbound while hidden). Extension is always-on (`tel:` click-to-dial + inbound
  banner on every tab), published: `chromewebstore.google.com/detail/…/keffpnadhppdelceioccednhjdghmbfi`.
  Code lives at `/mnt/data/Code/Office/Softphone-Extension/`. Settings page shows a one-time
  "Install the Chrome extension" card (`GET /api/settings/client-config` → `CHROME_EXTENSION_URL`).
- **Click-to-call (c2c)** — verified end-to-end (call to +919910513597, logged as `c2c-740026`)
- Team API: per-company **API keys** (X-Api-Key) + **rate limiting** + **Zod validation**
- DID/extension→user mapping (page + folded into Settings)
- App **uninstall** cleanup (`DELETE /oauth/callback`) + **dark theme**
- **Late-note back-fill**: note saved after a call is logged → attached as a Note on the
  linked person (`POST /api/calls/note`, reconciled by SIP id). softphone adapter exposes
  `window.IVR_saveNote(note, sipCallId)` — wire it to the softphone's note control in-product.
- **Database: MariaDB/MySQL** (ported off Postgres). Tables prefixed `pipedrive_`, live on the
  shared production FoundersCart DB. `npm run migrate` is idempotent + prefix-aware.
- Dashboard folded into Settings (sync status / stats / run-sync / API key).
- Deploy: Dockerfile + docker-compose (mariadb) + CI (test/db-tests×2/docker-build). 156 tests + 5 DB tests.

## REMAINING

### 1. Deploy to production (BLOCKER: production domain)
- [ ] Stable HTTPS domain off ngrok → point backend at it (production MariaDB already live).
- [ ] Update Dev Hub: OAuth callback + **settings.html + panel.html** URLs (NO floating window).
- [ ] Reconnect the sandbox on the fresh MariaDB → smoke-test OAuth + a real sync.

### 2. Extension / inbound (calling layer is now the Chrome extension)
- [ ] (optional) True screen-pop: have the extension's inbound banner call `/api/cti/lookup` →
      open the matching Pipedrive person URL (today it shows the number only).
- [ ] (optional) Late-note via extension: the extension softphone posts `/api/calls/note` using
      the per-company **X-Api-Key** (the SDK-JWT path was the old embedded softphone).

### 3. Dev Hub (user actions)
- [ ] Register **Custom Panel** (`/panel.html`, Person details) + **settings** page. Do NOT
      register a floating window (softphone is the extension).

### 4. Go public (decided: PUBLIC Marketplace)
See `docs/MARKETPLACE.md` (checklist, scope justification, listing copy — updated for the extension)
and `docs/PRIVACY.md` (privacy draft).
- [ ] Real IVR token (not the dev test token).
- [ ] Listing assets: icon, 3–5 screenshots, support contact, ToS + pricing URLs, hosted privacy policy.
- [ ] Demo video + test account, then **Send to review** (Pipedrive ~1–3 wk), then publish.
- NOTE: listing must state the companion Chrome extension requirement; multi-instance scaling
  intentionally **skipped** (single instance per user's decision).

## Key gotchas (don't relearn)
- **c2c DID format**: `c2c_get` rejects E.164 `+918044475500` ("Did No. Invalid"); needs
  `918044475500` (digits, keep country code, no `+`). Backend strips via `digitsOnly(did)`.
- CDN softphone iframe must be `…/softphone/index.html` (dir path 404s); framing not blocked.
- App Extensions SDK `+esm`: constructor is `default.default` — see the `typeof SDK==='function'` shim.
- Scope changes need **uninstall + reinstall** (re-auth alone keeps old scopes).
- `persons/search` works with `contacts:read`; create-person needs `contacts:full`; lead needs `leads:full`.
- Pipedrive call log `subject` is empty when fetched, but the linked **activity** has the title (fine).

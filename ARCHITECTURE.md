# IVRSolutions Pipedrive CRM Integration — Architecture

## Context

IVRSolutions / FoundersCart (Indian IVR/telephony, `support@founderscart.in`) already ships
a hosted WebRTC/SIP softphone plus two CRM integrations that wrap it:

- **Zoho** — browser-only extension, in production 1+ year (`/mnt/data/Code/Office/ivrsolutionszoho/CallLogsWidget/`).
- **Salesforce** — 2GP managed AppExchange package, late Beta (`/mnt/data/Code/Office/Salesforce/`).

This project gives **Pipedrive** the same three pillars:

1. **Embedded softphone** — login + take/place calls without leaving Pipedrive.
2. **Real-time CTI** — click-to-dial, inbound screen-pop, auto-log each call.
3. **Historical sync** — 15-min backfill from `POST /v1/all_call_logs`, idempotent via PBX Call Id.

The shared softphone (Browser-Phone) is **not** rebuilt — it stays on the CDN
(`https://cdn.founderscart.com/app/ivrsolutions/webrtc/softphone/`) and is embedded via iframe.

## Architecture decisions (signed off 2026-06-02)

| Decision | Choice | Rationale |
|---|---|---|
| **Distribution** | Private app first → public Marketplace later | Private apps need no Pipedrive review, install via link, full production. Same OAuth app promotes to public when mature (mirrors the Salesforce "Beta first" path). |
| **Softphone placement** | Custom **Floating Window** (softphone) + Custom **Panel** (sidebar) | Floating window is Pipedrive's official caller surface — always visible, persists across navigation, auto-binds phone-field clicks. Panel adds screen-pop context + recording playback on Person/Deal/Org pages. |
| **Backend** | Node.js + Express + Postgres | Holds OAuth `client_secret`, encrypted IVR tokens, the 15-min cron + sync cursors, and inbound-call signaling. Browser-only (the Zoho model) is **not viable** on Pipedrive. |
| **Call logging** | Native **CallLogs API** (`POST /v1/callLogs`) + **app-side dedupe** | Populates Pipedrive's native Call tab and supports recording upload. Pipedrive custom fields can't enforce uniqueness, so dedupe on PBX `recordid` lives in our Postgres. |

## Pipedrive platform facts (live docs, 2025-2026)

These correct several assumptions in the original kickoff prompt:

- **No "default dialer callback URL."** Caller apps = a **Custom Floating Window** UI extension +
  the **App Extensions SDK** (`@pipedrive/app-extensions-sdk`). Pipedrive auto-binds phone-field
  clicks to the floating window. Inbound screen-pop is driven by **our backend** signaling the
  window (WebSocket) which then calls `sdk.execute(SHOW_FLOATING_WINDOW)` + `redirect`.
- **CallLogs API is v1-only** (`GET/POST /v1/callLogs`, `POST /v1/callLogs/{id}/recordings`).
- **OAuth scopes**: `users:read`, `contacts:read`, `deals:read`, `activities:full`
  (Pipedrive uses `:read`/`:full`, **not** `:write`), and `phone-integration` for callLogs.
- **Custom fields have a hashed `key` but NO uniqueness flag** — dedupe is app-side.
- **API v2 is preferred** (~50% cheaper tokens) for persons/activities/activityFields; `/callLogs`
  stays v1. v1 deprecation is underway (selected endpoints through 2025-12-31; broad target 2026-07-31).
- **Rate limits are a token-based daily budget** (`30,000 × plan-multiplier × seats`).
  Search = 40 tokens each, hard cap **10 searches / 2s** on all plans → bulk phone lookups must
  throttle to <10/2s and cache the phone→personId map per run.
- **iframe microphone/autoplay policy is undocumented** — must be verified empirically in a
  sandbox app before committing to WebRTC-in-floating-window.

## Component layout

```
Pipedrive/
  backend/                  Node.js + Express + Postgres
    src/
      config.js             env loading + validation
      crypto.js             AES-256-GCM for IVR token at rest
      ivr/client.js         IVR API client (validate, all_call_logs, c2c) — injectable fetch
      pipedrive/            OAuth + REST client (persons search, callLogs, custom fields)  [TODO]
      db/                   pg pool, schema, token/cursor stores
      routes/               settings (token validate/save), health, oauth  [oauth TODO]
      sync/                 15-min cron worker (cursor-paged backfill)       [TODO]
    test/                   node:test unit tests (no external deps)
  frontend/                 Pipedrive Custom UI iframes (served as static)
    settings.html           admin pastes IVR token → validate → save
    softphone-host.html     Custom Floating Window: SDK bridge + softphone iframe  [skeleton]
    panel.html              Custom Panel: screen-pop context + recording player    [skeleton]
    js/pipedrive-cti-adapter.js   wraps Browser-Phone globals → IVR_* postMessage
```

## postMessage protocol (ported from Salesforce `ivrBridge.js` / `salesforce-cti-adapter.js`)

Softphone iframe → host:
- `{ type: 'IVR_READY' }`
- `{ type: 'IVR_INCOMING_CALL', number }`
- `{ type: 'IVR_CALL_CONNECTED', number, direction }`
- `{ type: 'IVR_SAVE_CONTACT', number }`

Host → softphone iframe:
- `{ action: 'IVR_DIAL', number, personId?, personName? }`
- `{ action: 'IVR_PROMPT_SAVE_CONTACT', number, timeoutMs }`

The host translates these to Pipedrive App Extensions SDK commands (click-to-dial, screen-pop
redirect) and backend calls (CallLogs creation, person search).

## Call-log model (mirrors Zoho/Salesforce exactly — do not reinvent)

`POST /v1/all_call_logs` body `{last_call_log_id, last_c2c_log_id, last_dialer_log_id}` →
`{status, call_logs[], click_to_call_logs[], dialer_logs[]}`, newest-first, **hard cap 20/category**.

Direction logic:
- `call_logs` + `call_type='outgoing'` → outbound, customer = `attended_by` ?? `outgoing_ext`.
- `call_logs` else → inbound, customer = `client_no`.
- `click_to_call_logs` + `dialer_logs` → always outbound, customer = `client_no`.

Dedupe key = `recordid` for `call_logs` (matches the real-time path's `sip_call_id` reconciliation),
`c2c-`/`dialer-` prefixed for the other two — stored in our Postgres `synced_calls` table.

Phone normalization: strip non-digits, take last 10; query Pipedrive persons search with variants
(`<10digit>`, `91<10>`, `+91<10>`, `0<10>`); cache map per run.

## Milestones

1. **Token validation slice (current)** — settings page → backend proxy →
   `POST /api/key_authentication` → green check. Proves auth + IVR plumbing.
2. Pipedrive OAuth handshake + token storage/refresh.
3. Floating-window softphone embed + CTI adapter on the CDN.
4. Click-to-dial via App Extensions SDK.
5. Inbound screen-pop (backend WebSocket → SDK).
6. Real-time CallLogs creation + recording upload.
7. 15-min sync cron with cursor + app-side dedupe.
8. Setup wizard + status dashboard + recording player panel.

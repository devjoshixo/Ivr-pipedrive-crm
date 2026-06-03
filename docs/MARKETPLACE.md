# Pipedrive Marketplace — Submission Checklist & Required Items

Everything needed to publish **IVRSolutions for Pipedrive** as a public Marketplace app.
Items are marked: ✅ done in code · 🔧 your action (hosting/listing) · ✍️ draft provided here.

---

## 1. Technical requirements (Pipedrive review)

| Requirement | Status | Evidence |
|---|---|---|
| Uses OAuth 2.0 as primary auth | ✅ | `pipedrive/oauth.js`, `/oauth/install` + `/oauth/callback` |
| Refreshes access token after expiry | ✅ | `tokenService` (refresh + self-heal on 401) |
| Does **not** store Pipedrive API tokens | ✅ | only OAuth tokens (refresh) + the customer's own IVR token (sealed) |
| Requests only necessary scopes | ✅ | see §3 |
| Secrets stored safely | ✅ | IVR token AES-256-GCM sealed; API keys SHA-256 hashed |
| Polished install **and uninstall** flows | ✅ | OAuth install; `DELETE /oauth/callback` purges data on uninstall |
| App extensions load without errors | ✅ | SDK init fixed; verified in-product |
| Supports light **and dark** theme | ✅ | `css/theme.css` + `js/theme.js`, respects `?theme=` |
| Adheres to rate limiting | ✅ | retry-with-backoff on 429/5xx; own per-company limiter |
| Stable public HTTPS host | 🔧 | deploy via `Dockerfile`/`docker-compose` (off ngrok) |
| Handles different user types / permissions | ✅ | company-scoped; SDK token + API-key auth |

## 2. Listing & legal requirements

| Item | Status | Notes |
|---|---|---|
| App name (unique, not Pipedrive-like) | ✍️ | "IVRSolutions CTI" / "IVRSolutions Softphone" |
| Short summary (value proposition) | ✍️ | see §4 |
| Full description (formatted, bulleted) | ✍️ | see §4 |
| App categories | 🔧 | Phone & SMS / Communication |
| Distinctive icon (not for dark bg) | 🔧 | provide IVRSolutions logo asset |
| 3–5 annotated screenshots | 🔧 | softphone, click-to-dial, screen-pop, call log, dashboard |
| Optional demo video | 🔧 | recommended (explains permissions + value) |
| **Privacy Policy** webpage (public URL) | ✍️🔧 | draft in `docs/PRIVACY.md` → host it, provide URL |
| **Terms of Service** webpage | 🔧 | provide URL |
| **Support contact** (email/page) | 🔧 | e.g. support@founderscart.in |
| **Pricing page** link | 🔧 | provide URL |
| Fully functional **test account** | 🔧 | a Pipedrive + IVR test login for reviewers |
| Demo video explaining permissions | 🔧 | required for review |
| Contact person for review comms | 🔧 | |

## 3. OAuth scopes — justification (for the review form)

| Scope | Why the app needs it |
|---|---|
| `users:read` | Resolve the company + owner on install; populate the DID/extension mapping. |
| `contacts:read` | Match inbound/outbound numbers to a Person for screen-pop and call-log linking. |
| `contacts:full` | Create a Person for an unknown caller (so the call can be logged). |
| `deals:read` | Associate calls with the related deal where applicable. |
| `leads:full` | Create a Lead for an unknown caller (triage), per the no-match policy. |
| `activities:full` | Create/update call activities and back-fill notes. |
| `phone-integration` | Create call logs via the CallLogs API (the core telephony feature). |

We deliberately do **not** request: mail, products, projects, goals, webhooks, field scopes,
admin, or "search for all data" (persons/search works under `contacts:read`).

## 4. Listing copy (draft)

**Name:** IVRSolutions for Pipedrive

**Short summary (≤ ~100 chars):**
> Embed the IVRSolutions softphone in Pipedrive — click-to-dial, screen-pop, and automatic call logging.

**Full description:**
> IVRSolutions brings your cloud telephony into Pipedrive. Agents take and place calls from an
> embedded softphone without leaving the CRM, every call is logged automatically against the
> right contact, and call recordings are one click away.
>
> **Features**
> - **Embedded softphone** — log in and handle calls inside Pipedrive (floating window).
> - **Click-to-dial** — call any phone number on a contact or lead in one click.
> - **Inbound screen-pop** — the matching contact opens automatically on an incoming call.
> - **Automatic call logging** — every call becomes a Pipedrive call activity with duration,
>   direction, and a recording link, linked to the right person.
> - **Unknown callers → Leads** — new numbers are captured as Leads for triage.
> - **Call recordings** — listen to recordings right on the contact's page.
> - **Background sync** — a continuous sync backfills any calls handled outside the browser.
>
> Requires an active IVRSolutions account.

## 5. Submission flow (Developer Hub)

1. Finish the **listing** fields (§2 + §4) and upload icon + screenshots.
2. Set OAuth **callback URL** + scopes (§3) to your production host.
3. Add the App extensions (floating window, panel, settings) with production URLs.
4. **Install + test** in a sandbox; record the **demo video**.
5. Provide **test account** + **support contact** + **privacy/ToS/pricing URLs**.
6. Click **Send to review** → respond to any reviewer feedback.
7. On approval the app is **unlisted** — manually **publish** to go live.

## 6. Data handling summary (for the security review)

- **What we store:** Pipedrive OAuth refresh token, the customer's IVR API token (AES-256-GCM
  sealed), sync cursors, a per-call dedupe ledger (PBX id, recording URL, linked person id),
  DID/extension→user mappings, and a hashed per-company API key.
- **What we do NOT store:** Pipedrive API tokens, call audio (only the IVR recording URL),
  raw API keys (SHA-256 hashed only).
- **Deletion:** on uninstall, all company data is purged (`DELETE /oauth/callback` → cascade).
- **Transport:** HTTPS only; tokens never exposed to the browser/iframe.

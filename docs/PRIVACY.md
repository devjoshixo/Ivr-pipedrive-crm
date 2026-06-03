# Privacy Policy — IVRSolutions for Pipedrive (DRAFT)

> Draft for the Marketplace listing. **Have it reviewed by your legal team**, host it at a
> public URL, and fill the `<placeholders>`. Replace this notice before publishing.

**Last updated:** `<date>`
**Provider:** `<Legal entity name>` ("we", "us"), `<address>`
**Contact:** `<support@founderscart.in>`

## What this app does
IVRSolutions for Pipedrive connects your IVRSolutions telephony account to your Pipedrive
account so calls can be dialed, screen-popped, and logged inside Pipedrive.

## Data we process
- **Pipedrive account data** (via OAuth, with your consent): users, persons/contacts, deals,
  leads, and activities — used to match calls to contacts, create call activities, and (for
  unknown callers) create a Person/Lead.
- **IVRSolutions call data**: call records (numbers, time, duration, direction, recording URL,
  notes) pulled from your IVRSolutions account to create call logs in Pipedrive.
- **Credentials**: your IVRSolutions API token (encrypted at rest), Pipedrive OAuth tokens, and
  a per-company API key (stored only as a hash).

## What we do NOT do
- We do not store your Pipedrive API tokens.
- We do not store call audio (only the recording URL provided by IVRSolutions).
- We do not sell or share your data with third parties for marketing.

## How data is stored & secured
- Transport over HTTPS only.
- IVR API tokens are encrypted at rest (AES-256-GCM); API keys are stored as SHA-256 hashes.
- Access is scoped per company; tokens are never exposed to the browser.

## Data retention & deletion
- Data is retained while the app is installed.
- **On uninstall, all of your data is deleted** (tokens, cursors, call ledger, mappings, keys).
- To request deletion at any time, contact `<support email>`.

## Sub-processors / hosting
- Hosted on `<hosting provider>`; database on `<DB provider>`.
- Telephony data originates from IVRSolutions (`api.ivrsolutions.in`).

## Your rights
You may request access to, correction of, or deletion of your data by contacting us at
`<support email>`. `<Add GDPR/CCPA specifics as applicable to your customers.>`

## Changes
We may update this policy; material changes will be posted at this URL with a new date.

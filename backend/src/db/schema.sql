-- IVRSolutions Pipedrive integration — Postgres schema.
-- One row per installed Pipedrive company (keyed by company_id from OAuth).

-- Installed companies: holds OAuth tokens + the encrypted IVR API token.
CREATE TABLE IF NOT EXISTS installs (
  company_id            TEXT PRIMARY KEY,           -- Pipedrive company id
  company_domain        TEXT,                       -- e.g. acme.pipedrive.com
  pd_access_token       TEXT,                       -- Pipedrive OAuth access token (milestone 2)
  pd_refresh_token      TEXT,                       -- expires after 60 days of inactivity
  pd_token_expires_at   TIMESTAMPTZ,
  ivr_token_sealed      TEXT,                       -- AES-256-GCM sealed IVR API token
  ivr_token_valid       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added in milestone 2 (idempotent so re-running migrate upgrades an existing table).
ALTER TABLE installs ADD COLUMN IF NOT EXISTS pd_api_domain TEXT;
ALTER TABLE installs ADD COLUMN IF NOT EXISTS pd_scope TEXT;
ALTER TABLE installs ADD COLUMN IF NOT EXISTS company_name TEXT;

-- Sync cursors: 3 categories per the IVR all_call_logs API (newest-first, 20/category cap).
CREATE TABLE IF NOT EXISTS sync_state (
  company_id            TEXT PRIMARY KEY REFERENCES installs(company_id) ON DELETE CASCADE,
  last_call_log_id      TEXT NOT NULL DEFAULT '',
  last_c2c_log_id       TEXT NOT NULL DEFAULT '',
  last_dialer_log_id    TEXT NOT NULL DEFAULT '',
  last_sync_at          TIMESTAMPTZ,
  last_error            TEXT,                        -- includes saturation WARN (>=20/category)
  last_error_at         TIMESTAMPTZ
);

-- App-side dedupe ledger: Pipedrive custom fields can't enforce uniqueness, so we
-- track which PBX call ids have been logged. Unique on (company_id, pbx_call_id).
CREATE TABLE IF NOT EXISTS synced_calls (
  company_id            TEXT NOT NULL REFERENCES installs(company_id) ON DELETE CASCADE,
  pbx_call_id           TEXT NOT NULL,               -- recordid (or c2c-/dialer-/rt- prefixed)
  pd_call_log_id        TEXT,                        -- Pipedrive callLog id once created
  pd_person_id          BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, pbx_call_id)
);

-- Added in milestone 6 (real-time logging + recording reconciliation). The SIP Call-ID
-- is the cross-path key: a real-time row (source='realtime') is later matched by the
-- sync via sip_call_id so the sync attaches the recording instead of duplicating.
ALTER TABLE synced_calls ADD COLUMN IF NOT EXISTS sip_call_id        TEXT;
ALTER TABLE synced_calls ADD COLUMN IF NOT EXISTS recording_url      TEXT;
ALTER TABLE synced_calls ADD COLUMN IF NOT EXISTS recording_attached BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE synced_calls ADD COLUMN IF NOT EXISTS source             TEXT;  -- 'realtime' | 'sync'
CREATE INDEX IF NOT EXISTS synced_calls_sip_idx ON synced_calls (company_id, sip_call_id);

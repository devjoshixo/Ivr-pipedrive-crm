-- IVRSolutions Pipedrive integration — MariaDB/MySQL schema.
-- `{{PREFIX}}` is replaced by migrate.js with DB_TABLE_PREFIX (e.g. `pipedrive_`) so
-- the app's tables live in their own namespace inside a shared database.
-- One row per installed Pipedrive company (keyed by company_id from OAuth).

-- Installed companies: holds OAuth tokens + the encrypted IVR API token.
CREATE TABLE IF NOT EXISTS {{PREFIX}}installs (
  company_id            VARCHAR(191) NOT NULL,           -- Pipedrive company id
  company_domain        VARCHAR(255),                    -- e.g. acme.pipedrive.com
  pd_api_domain         VARCHAR(255),                    -- e.g. https://acme.pipedrive.com
  pd_access_token       TEXT,                            -- Pipedrive OAuth access token
  pd_refresh_token      TEXT,                            -- expires after 60 days of inactivity
  pd_token_expires_at   DATETIME NULL,
  pd_scope              TEXT,
  company_name          VARCHAR(255),
  ivr_token_sealed      TEXT,                            -- AES-256-GCM sealed IVR API token
  ivr_token_valid       TINYINT(1) NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sync cursors: 3 categories per the IVR all_call_logs API (newest-first, 20/category cap).
CREATE TABLE IF NOT EXISTS {{PREFIX}}sync_state (
  company_id            VARCHAR(191) NOT NULL,
  last_call_log_id      VARCHAR(191) NOT NULL DEFAULT '',
  last_c2c_log_id       VARCHAR(191) NOT NULL DEFAULT '',
  last_dialer_log_id    VARCHAR(191) NOT NULL DEFAULT '',
  last_sync_at          DATETIME NULL,
  last_error            TEXT,                            -- includes saturation WARN (>=20/category)
  last_error_at         DATETIME NULL,
  PRIMARY KEY (company_id),
  CONSTRAINT fk_{{PREFIX}}sync_company FOREIGN KEY (company_id)
    REFERENCES {{PREFIX}}installs(company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-company API key for server-to-server access (only the hash is stored).
CREATE TABLE IF NOT EXISTS {{PREFIX}}company_api_keys (
  company_id            VARCHAR(191) NOT NULL,
  key_hash              VARCHAR(191) NOT NULL,
  key_prefix            VARCHAR(64) NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at          DATETIME NULL,
  PRIMARY KEY (company_id),
  KEY {{PREFIX}}api_keys_hash_idx (key_hash),
  CONSTRAINT fk_{{PREFIX}}apikey_company FOREIGN KEY (company_id)
    REFERENCES {{PREFIX}}installs(company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- DID + extension -> Pipedrive user mapping (click-to-call routing + call ownership).
CREATE TABLE IF NOT EXISTS {{PREFIX}}user_mappings (
  company_id            VARCHAR(191) NOT NULL,
  pd_user_id            BIGINT NOT NULL,
  did                   VARCHAR(64),
  extension             VARCHAR(64),
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, pd_user_id),
  CONSTRAINT fk_{{PREFIX}}map_company FOREIGN KEY (company_id)
    REFERENCES {{PREFIX}}installs(company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- App-side dedupe ledger: which PBX call ids have been logged (unique per company).
-- The SIP Call-ID is the cross-path key: a real-time row (source='realtime') is later
-- matched by the sync via sip_call_id so the sync attaches the recording (and late
-- notes resolve to the linked person) instead of duplicating.
CREATE TABLE IF NOT EXISTS {{PREFIX}}synced_calls (
  company_id            VARCHAR(191) NOT NULL,
  pbx_call_id           VARCHAR(191) NOT NULL,           -- recordid (or c2c-/dialer-/rt- prefixed)
  pd_call_log_id        VARCHAR(191),                    -- Pipedrive callLog id once created
  pd_person_id          BIGINT,
  sip_call_id           VARCHAR(191),
  recording_url         TEXT,
  recording_attached    TINYINT(1) NOT NULL DEFAULT 0,
  source                VARCHAR(32),                     -- 'realtime' | 'sync'
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, pbx_call_id),
  KEY {{PREFIX}}synced_calls_sip_idx (company_id, sip_call_id),
  CONSTRAINT fk_{{PREFIX}}calls_company FOREIGN KEY (company_id)
    REFERENCES {{PREFIX}}installs(company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

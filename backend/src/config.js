'use strict';

// Centralised configuration. Loads from environment; fails fast on missing required
// values at startup (see common/coding-style.md — validate at boundaries).

// dotenv is optional in production (real env vars), required for local dev.
try {
  // eslint-disable-next-line global-require
  require('dotenv').config();
} catch {
  /* dotenv not installed — assume real environment variables are present */
}

const { keyFromEnv } = require('./crypto');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

/**
 * Build and validate the config object. Throws if anything required is missing or invalid.
 * @returns {object}
 */
function loadConfig() {
  const tokenEncKey = keyFromEnv(required('IVR_TOKEN_ENC_KEY')); // throws if not 32 bytes

  return Object.freeze({
    port: Number(optional('PORT', '3000')),
    nodeEnv: optional('NODE_ENV', 'development'),

    // Database (MariaDB/MySQL): mysql://user:pass@host:port/db
    databaseUrl: required('DATABASE_URL'),
    // Prefix for this app's tables in a shared database (e.g. `pipedrive_`).
    tablePrefix: optional('DB_TABLE_PREFIX', ''),

    // IVR API
    ivrBaseUrl: optional('IVR_BASE_URL', 'https://api.ivrsolutions.in'),
    tokenEncKey,

    // What to do when an inbound/outbound number matches no existing Pipedrive person.
    // 'lead' = create Person + Lead (default), 'person' = create Person, 'skip' = don't log.
    noMatchPolicy: optional('NO_MATCH_POLICY', 'lead'),

    // How often the background poller pulls /v1/all_call_logs. Default 30s. Empty polls
    // are cheap (no Pipedrive cost); a 10s hard floor avoids hammering the IVR API.
    syncIntervalMs: Math.max(10000, Number(optional('SYNC_INTERVAL_MS', '30000')) || 30000),

    // Per-company rate limit on the team-facing API endpoints.
    rateLimitMax: Number(optional('RATE_LIMIT_MAX', '120')) || 120,
    rateLimitWindowMs: Number(optional('RATE_LIMIT_WINDOW_MS', '60000')) || 60000,

    // Pipedrive OAuth
    pipedrive: Object.freeze({
      clientId: optional('PIPEDRIVE_CLIENT_ID', ''),
      clientSecret: optional('PIPEDRIVE_CLIENT_SECRET', ''),
      redirectUri: optional('PIPEDRIVE_REDIRECT_URI', ''),
      // JWT secret for App Extensions SDK signed tokens. Defaults to the client secret
      // (matches the Developer Hub default for a floating window's JWT secret).
      jwtSecret: optional('PIPEDRIVE_JWT_SECRET', '') || optional('PIPEDRIVE_CLIENT_SECRET', ''),
    }),

    // Secret for signing the OAuth `state` (CSRF). Falls back to the client secret
    // so a single-instance dev setup works without extra config.
    oauthStateSecret: optional('OAUTH_STATE_SECRET', '') || optional('PIPEDRIVE_CLIENT_SECRET', 'dev-state-secret'),

    // Public base URL of this backend (for building the post-install redirect).
    publicBaseUrl: optional('PUBLIC_BASE_URL', ''),

    // Comma-separated list of origins allowed to call this backend (Pipedrive app domains).
    allowedOrigins: optional('ALLOWED_ORIGINS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
}

module.exports = { loadConfig };

'use strict';

// Logical table names and the optional install-wide prefix. The production database
// is shared (FoundersCart), so every table is prefixed (e.g. `pipedrive_`) to keep
// this app's tables in their own namespace. The prefix is sanitised because it is
// interpolated into SQL (table names can't be parameterised).

const LOGICAL = Object.freeze({
  installs: 'installs',
  syncState: 'sync_state',
  syncedCalls: 'synced_calls',
  apiKeys: 'company_api_keys',
  userMappings: 'user_mappings',
});

function sanitizePrefix(prefix) {
  const p = String(prefix == null ? '' : prefix);
  if (p && !/^[a-z0-9_]+$/i.test(p)) {
    throw new Error(`Invalid DB_TABLE_PREFIX (allowed: letters, digits, underscore): ${p}`);
  }
  return p;
}

/**
 * Build the prefixed physical table names.
 * @param {string} [prefix]
 * @returns {{installs, syncState, syncedCalls, apiKeys, userMappings}}
 */
function tableNames(prefix = '') {
  const p = sanitizePrefix(prefix);
  const out = {};
  for (const [key, logical] of Object.entries(LOGICAL)) {
    out[key] = `${p}${logical}`;
  }
  return Object.freeze(out);
}

module.exports = { tableNames, sanitizePrefix, LOGICAL };

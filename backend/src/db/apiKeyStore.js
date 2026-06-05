'use strict';

// Data access for per-company API keys. Stores only the SHA-256 hash; the raw key
// is returned exactly once at generation time for the admin to copy.

const { generateApiKey, hashApiKey } = require('../apikey');
const { tableNames } = require('./tables');

/**
 * @param {{query: Function}} pool
 * @param {ReturnType<typeof tableNames>} [tables]
 */
function createApiKeyStore(pool, tables = tableNames()) {
  const T = tables.apiKeys;

  /**
   * Generate (or replace) the company's API key. Returns the raw key once.
   * @returns {Promise<{key: string, prefix: string}>}
   */
  async function regenerate(companyId) {
    const { key, hash, prefix } = generateApiKey();
    await pool.query(
      `INSERT INTO ${T} (company_id, key_hash, key_prefix, created_at, last_used_at)
       VALUES ($1, $2, $3, now(), NULL)
       ON DUPLICATE KEY UPDATE key_hash = VALUES(key_hash), key_prefix = VALUES(key_prefix),
                               created_at = now(), last_used_at = NULL`,
      [companyId, hash, prefix]
    );
    return { key, prefix };
  }

  /**
   * Resolve a raw API key to a company id (or null). Updates last_used_at best-effort.
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async function resolveCompany(key) {
    if (!key) return null;
    const hash = hashApiKey(key);
    const { rows } = await pool.query(
      `SELECT company_id FROM ${T} WHERE key_hash = $1`,
      [hash]
    );
    if (!rows[0]) return null;
    pool
      .query(`UPDATE ${T} SET last_used_at = now() WHERE key_hash = $1`, [hash])
      .catch(() => {});
    return rows[0].company_id;
  }

  /** Non-secret metadata for the dashboard (prefix + timestamps). */
  async function getMeta(companyId) {
    const { rows } = await pool.query(
      `SELECT key_prefix, created_at, last_used_at FROM ${T} WHERE company_id = $1`,
      [companyId]
    );
    return rows[0]
      ? { prefix: rows[0].key_prefix, createdAt: rows[0].created_at, lastUsedAt: rows[0].last_used_at }
      : null;
  }

  return { regenerate, resolveCompany, getMeta };
}

module.exports = { createApiKeyStore };

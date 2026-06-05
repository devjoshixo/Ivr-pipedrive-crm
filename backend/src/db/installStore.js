'use strict';

// Data access for the `installs` table. The IVR token is sealed (AES-256-GCM)
// before it ever touches the database and decrypted only in memory when needed.

const { encrypt, decrypt } = require('../crypto');
const { tableNames } = require('./tables');

/**
 * @param {{query: Function}} pool
 * @param {Buffer} tokenEncKey
 * @param {ReturnType<typeof tableNames>} [tables]
 */
function createInstallStore(pool, tokenEncKey, tables = tableNames()) {
  const T = tables.installs;

  /**
   * Store (or replace) the IVR token for a company, sealed at rest.
   * @param {string} companyId
   * @param {string} ivrToken
   * @param {boolean} valid
   */
  async function saveIvrToken(companyId, ivrToken, valid) {
    const sealed = encrypt(ivrToken, tokenEncKey);
    await pool.query(
      `INSERT INTO ${T} (company_id, ivr_token_sealed, ivr_token_valid, updated_at)
       VALUES ($1, $2, $3, now())
       ON DUPLICATE KEY UPDATE
         ivr_token_sealed = VALUES(ivr_token_sealed),
         ivr_token_valid  = VALUES(ivr_token_valid),
         updated_at       = now()`,
      [companyId, sealed, valid ? 1 : 0]
    );
  }

  /**
   * Return the decrypted IVR token for a company, or null if none stored.
   * @param {string} companyId
   * @returns {Promise<string|null>}
   */
  async function getIvrToken(companyId) {
    const { rows } = await pool.query(
      `SELECT ivr_token_sealed FROM ${T} WHERE company_id = $1`,
      [companyId]
    );
    if (rows.length === 0 || !rows[0].ivr_token_sealed) return null;
    return decrypt(rows[0].ivr_token_sealed, tokenEncKey);
  }

  /**
   * Store (or replace) the Pipedrive OAuth tokens + company info for an install.
   * @param {string} companyId
   * @param {object} t
   * @param {string} [t.companyDomain]
   * @param {string} [t.apiDomain]
   * @param {string} t.accessToken
   * @param {string} t.refreshToken
   * @param {string} [t.scope]
   * @param {Date} t.expiresAt
   */
  async function savePipedriveTokens(companyId, t) {
    await pool.query(
      `INSERT INTO ${T}
         (company_id, company_domain, pd_api_domain, pd_access_token,
          pd_refresh_token, pd_scope, pd_token_expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON DUPLICATE KEY UPDATE
         company_domain      = COALESCE(VALUES(company_domain), company_domain),
         pd_api_domain       = VALUES(pd_api_domain),
         pd_access_token     = VALUES(pd_access_token),
         pd_refresh_token    = VALUES(pd_refresh_token),
         pd_scope            = VALUES(pd_scope),
         pd_token_expires_at = VALUES(pd_token_expires_at),
         updated_at          = now()`,
      [
        companyId,
        t.companyDomain ?? null,
        t.apiDomain ?? null,
        t.accessToken,
        t.refreshToken,
        t.scope ?? null,
        t.expiresAt,
      ]
    );
  }

  /**
   * Return the full install row for a company, or null.
   * @param {string} companyId
   * @returns {Promise<object|null>}
   */
  async function getInstall(companyId) {
    const { rows } = await pool.query(`SELECT * FROM ${T} WHERE company_id = $1`, [companyId]);
    return rows[0] || null;
  }

  /**
   * Delete a company and all its data (cascades to sync_state, synced_calls,
   * user_mappings, company_api_keys via ON DELETE CASCADE). Called on app uninstall.
   * @param {string} companyId
   */
  async function deleteCompany(companyId) {
    await pool.query(`DELETE FROM ${T} WHERE company_id = $1`, [companyId]);
  }

  /**
   * Company ids that are fully connected (have both an IVR token and Pipedrive
   * OAuth tokens) — the set the scheduler syncs.
   * @returns {Promise<string[]>}
   */
  async function listConnectedCompanyIds() {
    const { rows } = await pool.query(
      `SELECT company_id FROM ${T}
       WHERE ivr_token_sealed IS NOT NULL AND pd_refresh_token IS NOT NULL`
    );
    return rows.map((r) => r.company_id);
  }

  return {
    saveIvrToken,
    getIvrToken,
    savePipedriveTokens,
    getInstall,
    deleteCompany,
    listConnectedCompanyIds,
  };
}

module.exports = { createInstallStore };

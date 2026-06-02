'use strict';

// Data access for the `installs` table. The IVR token is sealed (AES-256-GCM)
// before it ever touches the database and decrypted only in memory when needed.

const { encrypt, decrypt } = require('../crypto');

/**
 * @param {import('pg').Pool} pool
 * @param {Buffer} tokenEncKey
 */
function createInstallStore(pool, tokenEncKey) {
  /**
   * Store (or replace) the IVR token for a company, sealed at rest.
   * @param {string} companyId
   * @param {string} ivrToken
   * @param {boolean} valid
   */
  async function saveIvrToken(companyId, ivrToken, valid) {
    const sealed = encrypt(ivrToken, tokenEncKey);
    await pool.query(
      `INSERT INTO installs (company_id, ivr_token_sealed, ivr_token_valid, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (company_id)
       DO UPDATE SET ivr_token_sealed = EXCLUDED.ivr_token_sealed,
                     ivr_token_valid  = EXCLUDED.ivr_token_valid,
                     updated_at       = now()`,
      [companyId, sealed, valid]
    );
  }

  /**
   * Return the decrypted IVR token for a company, or null if none stored.
   * @param {string} companyId
   * @returns {Promise<string|null>}
   */
  async function getIvrToken(companyId) {
    const { rows } = await pool.query(
      'SELECT ivr_token_sealed FROM installs WHERE company_id = $1',
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
      `INSERT INTO installs
         (company_id, company_domain, pd_api_domain, pd_access_token,
          pd_refresh_token, pd_scope, pd_token_expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (company_id)
       DO UPDATE SET company_domain      = COALESCE(EXCLUDED.company_domain, installs.company_domain),
                     pd_api_domain       = EXCLUDED.pd_api_domain,
                     pd_access_token     = EXCLUDED.pd_access_token,
                     pd_refresh_token    = EXCLUDED.pd_refresh_token,
                     pd_scope            = EXCLUDED.pd_scope,
                     pd_token_expires_at = EXCLUDED.pd_token_expires_at,
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
    const { rows } = await pool.query('SELECT * FROM installs WHERE company_id = $1', [companyId]);
    return rows[0] || null;
  }

  /**
   * Company ids that are fully connected (have both an IVR token and Pipedrive
   * OAuth tokens) — the set the scheduler syncs.
   * @returns {Promise<string[]>}
   */
  async function listConnectedCompanyIds() {
    const { rows } = await pool.query(
      `SELECT company_id FROM installs
       WHERE ivr_token_sealed IS NOT NULL AND pd_refresh_token IS NOT NULL`
    );
    return rows.map((r) => r.company_id);
  }

  return {
    saveIvrToken,
    getIvrToken,
    savePipedriveTokens,
    getInstall,
    listConnectedCompanyIds,
  };
}

module.exports = { createInstallStore };

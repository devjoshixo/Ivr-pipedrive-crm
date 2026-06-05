'use strict';

// Data access for DID/extension -> Pipedrive user mappings. Used to route c2c
// click-to-call (which extension to ring) and to attribute call ownership.

const { tableNames } = require('./tables');

/**
 * @param {{query: Function}} pool
 * @param {ReturnType<typeof tableNames>} [tables]
 */
function createMappingStore(pool, tables = tableNames()) {
  const T = tables.userMappings;

  async function listMappings(companyId) {
    const { rows } = await pool.query(
      `SELECT pd_user_id, did, extension FROM ${T} WHERE company_id = $1`,
      [companyId]
    );
    return rows.map((r) => ({ pdUserId: String(r.pd_user_id), did: r.did, extension: r.extension }));
  }

  async function getForUser(companyId, pdUserId) {
    const { rows } = await pool.query(
      `SELECT did, extension FROM ${T} WHERE company_id = $1 AND pd_user_id = $2`,
      [companyId, pdUserId]
    );
    return rows[0] ? { did: rows[0].did, extension: rows[0].extension } : null;
  }

  /** Find the Pipedrive user that owns a given extension (for call ownership). */
  async function getUserByExtension(companyId, extension) {
    if (!extension) return null;
    const { rows } = await pool.query(
      `SELECT pd_user_id FROM ${T} WHERE company_id = $1 AND extension = $2 LIMIT 1`,
      [companyId, String(extension)]
    );
    return rows[0] ? String(rows[0].pd_user_id) : null;
  }

  async function saveMapping(companyId, { pdUserId, did, extension }) {
    await pool.query(
      `INSERT INTO ${T} (company_id, pd_user_id, did, extension, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON DUPLICATE KEY UPDATE did = VALUES(did), extension = VALUES(extension), updated_at = now()`,
      [companyId, pdUserId, did || null, extension || null]
    );
  }

  return { listMappings, getForUser, getUserByExtension, saveMapping };
}

module.exports = { createMappingStore };

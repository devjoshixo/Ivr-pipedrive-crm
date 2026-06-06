'use strict';

// Data access for sync cursors (sync_state) and the app-side dedupe ledger
// (synced_calls). Pipedrive custom fields can't enforce uniqueness, so dedupe
// lives here: a (company_id, pbx_call_id) primary key.

const { tableNames } = require('./tables');

/**
 * @param {{query: Function}} pool
 * @param {ReturnType<typeof tableNames>} [tables]
 */
function createSyncStore(pool, tables = tableNames()) {
  const STATE = tables.syncState;
  const CALLS = tables.syncedCalls;
  const INTENTS = tables.c2cIntents;

  /** Return the three cursors for a company, creating an empty row if needed. */
  async function getCursors(companyId) {
    await pool.query(`INSERT IGNORE INTO ${STATE} (company_id) VALUES ($1)`, [companyId]);
    const { rows } = await pool.query(
      `SELECT last_call_log_id, last_c2c_log_id, last_dialer_log_id
       FROM ${STATE} WHERE company_id = $1`,
      [companyId]
    );
    const r = rows[0] || {};
    return {
      lastCallLogId: r.last_call_log_id || '',
      lastC2cLogId: r.last_c2c_log_id || '',
      lastDialerLogId: r.last_dialer_log_id || '',
    };
  }

  async function saveCursors(companyId, cursors) {
    await pool.query(
      `UPDATE ${STATE}
         SET last_call_log_id = $2, last_c2c_log_id = $3, last_dialer_log_id = $4
       WHERE company_id = $1`,
      [companyId, cursors.lastCallLogId, cursors.lastC2cLogId, cursors.lastDialerLogId]
    );
  }

  /** Return the subset of callIds already recorded for this company. */
  async function filterSeen(companyId, callIds) {
    if (!callIds || callIds.length === 0) return new Set();
    const { rows } = await pool.query(
      `SELECT pbx_call_id FROM ${CALLS} WHERE company_id = $1 AND pbx_call_id IN ($2)`,
      [companyId, callIds]
    );
    return new Set(rows.map((r) => r.pbx_call_id));
  }

  async function markSeen(
    companyId,
    { pbxCallId, sipCallId, pdCallLogId, personId, recordingUrl, recordingAttached, source }
  ) {
    await pool.query(
      `INSERT IGNORE INTO ${CALLS}
         (company_id, pbx_call_id, pd_call_log_id, pd_person_id, sip_call_id,
          recording_url, recording_attached, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        companyId,
        pbxCallId,
        pdCallLogId || null,
        personId || null,
        sipCallId || null,
        recordingUrl || null,
        recordingAttached ? 1 : 0,
        source || null,
      ]
    );
  }

  /**
   * Map of sip_call_id -> real-time ledger row, for reconciling sync records against
   * call logs already created by the real-time path.
   */
  async function getRealtimeBySip(companyId, sipIds) {
    const ids = (sipIds || []).filter(Boolean);
    if (ids.length === 0) return new Map();
    const { rows } = await pool.query(
      `SELECT sip_call_id, pbx_call_id, pd_call_log_id, recording_attached
       FROM ${CALLS}
       WHERE company_id = $1 AND source = 'realtime' AND sip_call_id IN ($2)`,
      [companyId, ids]
    );
    const m = new Map();
    for (const r of rows) {
      m.set(r.sip_call_id, {
        pbxCallId: r.pbx_call_id,
        pdCallLogId: r.pd_call_log_id,
        recordingAttached: Boolean(r.recording_attached),
      });
    }
    return m;
  }

  /**
   * Look up the most recent ledger row for a SIP Call-ID. Powers the late-note
   * back-fill, which needs the linked person + pbx id for an already-logged call.
   * @returns {Promise<{pbxCallId, pdCallLogId, personId}|null>}
   */
  async function getBySip(companyId, sipCallId) {
    if (!sipCallId) return null;
    const { rows } = await pool.query(
      `SELECT pbx_call_id, pd_call_log_id, pd_person_id
       FROM ${CALLS}
       WHERE company_id = $1 AND sip_call_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [companyId, sipCallId]
    );
    const r = rows[0];
    if (!r) return null;
    return { pbxCallId: r.pbx_call_id, pdCallLogId: r.pd_call_log_id, personId: r.pd_person_id };
  }

  async function markRecordingAttached(companyId, sipCallId, { recordingUrl, attached }) {
    await pool.query(
      `UPDATE ${CALLS}
         SET recording_attached = $3,
             recording_url = COALESCE($4, recording_url)
       WHERE company_id = $1 AND sip_call_id = $2`,
      [companyId, sipCallId, attached ? 1 : 0, recordingUrl || null]
    );
  }

  /** Recent calls with a recording URL for a person — powers the recording-player panel. */
  async function recentForPerson(companyId, personId, limit = 10) {
    const { rows } = await pool.query(
      `SELECT pbx_call_id, recording_url, source, created_at
       FROM ${CALLS}
       WHERE company_id = $1 AND pd_person_id = $2 AND recording_url IS NOT NULL
       ORDER BY created_at DESC
       LIMIT $3`,
      [companyId, personId, limit]
    );
    return rows.map((r) => ({
      pbxCallId: r.pbx_call_id,
      recordingUrl: r.recording_url,
      source: r.source,
      createdAt: r.created_at,
    }));
  }

  async function recordError(companyId, message) {
    await pool.query(
      `UPDATE ${STATE}
         SET last_sync_at = now(), last_error = $2, last_error_at = now()
       WHERE company_id = $1`,
      [companyId, String(message).slice(0, 1000)]
    );
  }

  async function recordSuccess(companyId) {
    await pool.query(
      `UPDATE ${STATE} SET last_sync_at = now(), last_error = NULL, last_error_at = NULL
       WHERE company_id = $1`,
      [companyId]
    );
  }

  async function getSyncState(companyId) {
    const { rows } = await pool.query(`SELECT * FROM ${STATE} WHERE company_id = $1`, [companyId]);
    return rows[0] || null;
  }

  /**
   * Record whether a cursor is currently held (a failure is blocking cursor advance).
   * Pruning skips companies whose cursor is held, so it never deletes a ledger row the
   * sync might still re-pull and re-create.
   */
  async function setCursorHeld(companyId, held) {
    await pool.query(`UPDATE ${STATE} SET cursor_held = $2 WHERE company_id = $1`, [
      companyId,
      held ? 1 : 0,
    ]);
  }

  /**
   * Delete dedupe-ledger rows older than `retentionDays`. Storage hygiene that is safe
   * because of two guards:
   *   1. The IVR API only returns calls NEWER than sync_state.last_*_id, so a settled
   *      old row can never be re-fetched (and the cursors are never pruned).
   *   2. We skip any company whose cursor is HELD (cursor_held=1) — i.e. a failure is
   *      blocking cursor advance and the page is being re-pulled. Without this, pruning
   *      a succeeded row in a stuck page would let it be re-created as a duplicate.
   * @param {number} retentionDays - rows older than this are removed; <=0 disables (no-op)
   * @param {{now?: number}} [opts]
   * @returns {Promise<number>} rows deleted
   */
  async function pruneSyncedCalls(retentionDays, { now = Date.now() } = {}) {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const { rows } = await pool.query(
      `DELETE ${CALLS} FROM ${CALLS}
         JOIN ${STATE} ON ${STATE}.company_id = ${CALLS}.company_id
       WHERE ${CALLS}.created_at < $1 AND ${STATE}.cursor_held = 0`,
      [cutoff]
    );
    // c2c intents are normally deleted on use; sweep any stragglers (a c2c whose call
    // never came back through the sync). They are only useful for minutes.
    await pool.query(`DELETE FROM ${INTENTS} WHERE created_at < $1`, [
      new Date(now - 24 * 60 * 60 * 1000),
    ]);
    return (rows && rows.affectedRows) || 0;
  }

  /** Aggregate counts for the setup dashboard. */
  async function getStats(companyId) {
    const { rows } = await pool.query(
      `SELECT count(*)                                                  AS total,
              SUM(CASE WHEN source = 'sync' THEN 1 ELSE 0 END)          AS via_sync,
              SUM(CASE WHEN source = 'realtime' THEN 1 ELSE 0 END)      AS via_realtime,
              count(DISTINCT pd_person_id)                              AS people,
              SUM(CASE WHEN recording_attached = 1 THEN 1 ELSE 0 END)   AS with_recording
       FROM ${CALLS} WHERE company_id = $1`,
      [companyId]
    );
    const r = rows[0] || {};
    return {
      total: Number(r.total) || 0,
      viaSync: Number(r.via_sync) || 0,
      viaRealtime: Number(r.via_realtime) || 0,
      people: Number(r.people) || 0,
      withRecording: Number(r.with_recording) || 0,
    };
  }

  /**
   * Click-to-call intent: remember which Person the agent dialed from, keyed by the
   * PBX call id ('c2c-<recordid>'). The sync reads this to attach the c2c call log to
   * that exact Person instead of re-deriving it by phone search.
   */
  async function saveC2cIntent(companyId, { pbxCallId, personId }) {
    if (!pbxCallId || personId == null) return;
    await pool.query(
      `INSERT INTO ${INTENTS} (company_id, pbx_call_id, pd_person_id)
       VALUES ($1, $2, $3)
       ON DUPLICATE KEY UPDATE pd_person_id = VALUES(pd_person_id)`,
      [companyId, pbxCallId, personId]
    );
  }

  async function getC2cIntent(companyId, pbxCallId) {
    if (!pbxCallId) return null;
    const { rows } = await pool.query(
      `SELECT pd_person_id FROM ${INTENTS} WHERE company_id = $1 AND pbx_call_id = $2`,
      [companyId, pbxCallId]
    );
    const r = rows[0];
    return r ? { personId: r.pd_person_id == null ? null : Number(r.pd_person_id) } : null;
  }

  async function deleteC2cIntent(companyId, pbxCallId) {
    if (!pbxCallId) return;
    await pool.query(`DELETE FROM ${INTENTS} WHERE company_id = $1 AND pbx_call_id = $2`, [
      companyId,
      pbxCallId,
    ]);
  }

  return {
    getCursors,
    saveCursors,
    filterSeen,
    markSeen,
    getRealtimeBySip,
    getBySip,
    markRecordingAttached,
    pruneSyncedCalls,
    recentForPerson,
    recordError,
    recordSuccess,
    getSyncState,
    setCursorHeld,
    getStats,
    saveC2cIntent,
    getC2cIntent,
    deleteC2cIntent,
  };
}

module.exports = { createSyncStore };

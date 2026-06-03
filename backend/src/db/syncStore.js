'use strict';

// Data access for sync cursors (sync_state) and the app-side dedupe ledger
// (synced_calls). Pipedrive custom fields can't enforce uniqueness, so dedupe
// lives here: a (company_id, pbx_call_id) primary key.

/**
 * @param {import('pg').Pool} pool
 */
function createSyncStore(pool) {
  /** Return the three cursors for a company, creating an empty row if needed. */
  async function getCursors(companyId) {
    await pool.query(
      `INSERT INTO sync_state (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING`,
      [companyId]
    );
    const { rows } = await pool.query(
      `SELECT last_call_log_id, last_c2c_log_id, last_dialer_log_id
       FROM sync_state WHERE company_id = $1`,
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
      `UPDATE sync_state
         SET last_call_log_id = $2, last_c2c_log_id = $3, last_dialer_log_id = $4
       WHERE company_id = $1`,
      [companyId, cursors.lastCallLogId, cursors.lastC2cLogId, cursors.lastDialerLogId]
    );
  }

  /** Return the subset of callIds already recorded for this company. */
  async function filterSeen(companyId, callIds) {
    if (!callIds || callIds.length === 0) return new Set();
    const { rows } = await pool.query(
      `SELECT pbx_call_id FROM synced_calls WHERE company_id = $1 AND pbx_call_id = ANY($2::text[])`,
      [companyId, callIds]
    );
    return new Set(rows.map((r) => r.pbx_call_id));
  }

  async function markSeen(
    companyId,
    { pbxCallId, sipCallId, pdCallLogId, personId, recordingUrl, recordingAttached, source }
  ) {
    await pool.query(
      `INSERT INTO synced_calls
         (company_id, pbx_call_id, pd_call_log_id, pd_person_id, sip_call_id,
          recording_url, recording_attached, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (company_id, pbx_call_id) DO NOTHING`,
      [
        companyId,
        pbxCallId,
        pdCallLogId || null,
        personId || null,
        sipCallId || null,
        recordingUrl || null,
        Boolean(recordingAttached),
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
       FROM synced_calls
       WHERE company_id = $1 AND source = 'realtime' AND sip_call_id = ANY($2::text[])`,
      [companyId, ids]
    );
    const m = new Map();
    for (const r of rows) {
      m.set(r.sip_call_id, {
        pbxCallId: r.pbx_call_id,
        pdCallLogId: r.pd_call_log_id,
        recordingAttached: r.recording_attached,
      });
    }
    return m;
  }

  async function markRecordingAttached(companyId, sipCallId, { recordingUrl, attached }) {
    await pool.query(
      `UPDATE synced_calls
         SET recording_attached = $3,
             recording_url = COALESCE($4, recording_url)
       WHERE company_id = $1 AND sip_call_id = $2`,
      [companyId, sipCallId, Boolean(attached), recordingUrl || null]
    );
  }

  /** Recent calls with a recording URL for a person — powers the recording-player panel. */
  async function recentForPerson(companyId, personId, limit = 10) {
    const { rows } = await pool.query(
      `SELECT pbx_call_id, recording_url, source, created_at
       FROM synced_calls
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
      `UPDATE sync_state
         SET last_sync_at = now(), last_error = $2, last_error_at = now()
       WHERE company_id = $1`,
      [companyId, String(message).slice(0, 1000)]
    );
  }

  async function recordSuccess(companyId) {
    await pool.query(
      `UPDATE sync_state SET last_sync_at = now(), last_error = NULL, last_error_at = NULL
       WHERE company_id = $1`,
      [companyId]
    );
  }

  async function getSyncState(companyId) {
    const { rows } = await pool.query('SELECT * FROM sync_state WHERE company_id = $1', [companyId]);
    return rows[0] || null;
  }

  /** Aggregate counts for the setup dashboard. */
  async function getStats(companyId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int                                          AS total,
              count(*) FILTER (WHERE source = 'sync')::int           AS via_sync,
              count(*) FILTER (WHERE source = 'realtime')::int       AS via_realtime,
              count(DISTINCT pd_person_id)::int                      AS people,
              count(*) FILTER (WHERE recording_attached)::int        AS with_recording
       FROM synced_calls WHERE company_id = $1`,
      [companyId]
    );
    const r = rows[0] || {};
    return {
      total: r.total || 0,
      viaSync: r.via_sync || 0,
      viaRealtime: r.via_realtime || 0,
      people: r.people || 0,
      withRecording: r.with_recording || 0,
    };
  }

  return {
    getCursors,
    saveCursors,
    filterSeen,
    markSeen,
    getRealtimeBySip,
    markRecordingAttached,
    recentForPerson,
    recordError,
    recordSuccess,
    getSyncState,
    getStats,
  };
}

module.exports = { createSyncStore };

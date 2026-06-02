'use strict';

// Client for the IVRSolutions backend API (same API used by the Zoho + Salesforce
// integrations). All endpoints authenticate with a Bearer token. `fetchImpl` is
// injectable so the client is unit-testable without network access.

const DEFAULT_BASE_URL = 'https://api.ivrsolutions.in';

/**
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createIvrClient({ baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available (Node 18+ or inject fetchImpl)');
  }

  function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  /**
   * Validate an IVR API token via POST /api/key_authentication with an empty body.
   * Returns true only when the API reports `status === 200`. Never throws — a network
   * or parse failure is treated as "not valid" so callers get a simple boolean.
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async function validateToken(token) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/key_authentication`, {
        method: 'POST',
        headers: authHeaders(token),
        body: '{}',
      });
      if (!res.ok) return false;
      const data = await res.json();
      return Boolean(data) && data.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Fetch historical call logs. The API caps results at 20 per category and ignores
   * limit/page/offset, so callers must run frequently and advance cursors.
   * @param {string} token
   * @param {{lastCallLogId?: string, lastC2cLogId?: string, lastDialerLogId?: string}} cursors
   * @returns {Promise<object>} raw response: {status, call_logs[], click_to_call_logs[], dialer_logs[]}
   */
  async function fetchAllCallLogs(token, cursors = {}) {
    const body = JSON.stringify({
      last_call_log_id: cursors.lastCallLogId ?? '',
      last_c2c_log_id: cursors.lastC2cLogId ?? '',
      last_dialer_log_id: cursors.lastDialerLogId ?? '',
    });
    const res = await fetchImpl(`${baseUrl}/v1/all_call_logs`, {
      method: 'POST',
      headers: authHeaders(token),
      body,
    });
    return res.json();
  }

  /**
   * Trigger a click-to-call via GET /v1/c2c_get.
   * @param {string} token
   * @param {{did: string, extNo: string, phone: string}} params
   * @returns {Promise<object>} {status, recordid, message?}
   */
  async function triggerClickToCall(token, { did, extNo, phone }) {
    const qs = new URLSearchParams({ token, did, ext_no: extNo, phone });
    const res = await fetchImpl(`${baseUrl}/v1/c2c_get?${qs.toString()}`, { method: 'GET' });
    return res.json();
  }

  return { validateToken, fetchAllCallLogs, triggerClickToCall };
}

module.exports = { createIvrClient, DEFAULT_BASE_URL };

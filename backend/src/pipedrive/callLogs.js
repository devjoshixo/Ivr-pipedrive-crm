'use strict';

// Pipedrive CallLogs API client. A call log is treated as an Activity and shows in
// the native Call tab. Recording attachment (POST /callLogs/{id}/recordings) is a
// multipart audio upload — deferred; for now the recording URL lives in the note.

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createCallLogsClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  /**
   * Create a call log. Returns the created record's data.
   * @param {string} apiDomain
   * @param {string} accessToken
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async function createCallLog(apiDomain, accessToken, payload) {
    const res = await fetchImpl(`${apiDomain}/api/v1/callLogs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Pipedrive callLogs create returned ${res.status}`);
    }
    const body = await res.json();
    return body && body.data ? body.data : body;
  }

  return { createCallLog };
}

module.exports = { createCallLogsClient };

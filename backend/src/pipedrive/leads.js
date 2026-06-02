'use strict';

// Pipedrive Leads client. A Pipedrive lead must be attached to a person or
// organization, so the caller creates the person first and passes its id here.
// Used for unknown callers so they land in the Leads Inbox rather than the pipeline.

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createLeadsClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  /**
   * @param {string} apiDomain
   * @param {string} accessToken
   * @param {{title: string, personId: number}} lead
   * @returns {Promise<{leadId: string}>}
   */
  async function createLead(apiDomain, accessToken, { title, personId }) {
    const res = await fetchImpl(`${apiDomain}/api/v1/leads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, person_id: personId }),
    });
    if (!res.ok) {
      throw new Error(`Pipedrive leads create returned ${res.status}`);
    }
    const body = await res.json();
    const d = (body && body.data) || {};
    return { leadId: d.id };
  }

  return { createLead };
}

module.exports = { createLeadsClient };

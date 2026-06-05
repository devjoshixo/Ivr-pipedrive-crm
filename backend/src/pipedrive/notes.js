'use strict';

// Pipedrive Notes API client. Used to back-fill an agent's post-call note: a call log
// (Activity) has no update endpoint, so a late note is attached as a Note on the
// person the call was already linked to. A Note must reference at least one parent
// entity (person/org/lead/deal).

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createNotesClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  /**
   * Create a note. Returns the created record's data.
   * @param {string} apiDomain
   * @param {string} accessToken
   * @param {{content: string, personId?: number, orgId?: number, leadId?: string, dealId?: number}} note
   * @returns {Promise<object>}
   */
  async function addNote(apiDomain, accessToken, { content, personId, orgId, leadId, dealId }) {
    const payload = { content };
    if (personId) payload.person_id = personId;
    if (orgId) payload.org_id = orgId;
    if (leadId) payload.lead_id = leadId;
    if (dealId) payload.deal_id = dealId;
    const res = await fetchImpl(`${apiDomain}/api/v1/notes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Pipedrive notes create returned ${res.status}`);
    }
    const body = await res.json();
    return body && body.data ? body.data : body;
  }

  return { addNote };
}

module.exports = { createNotesClient };

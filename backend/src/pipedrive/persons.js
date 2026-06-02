'use strict';

// Pipedrive person lookup by phone number, used for inbound screen-pop and (later)
// the sync's person matching. Tries phone variants until one matches.
//
// Rate-limit note: each variant is a Search request (40 tokens, hard cap 10/2s).
// For interactive screen-pop (one number) this is fine; the bulk sync will batch
// and cache per run (milestone 7).

const { variants } = require('../phone');

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createPersonsClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  /**
   * Raw persons/search for a single term. Returns the items array.
   */
  async function searchByTerm(apiDomain, accessToken, term) {
    const qs = new URLSearchParams({
      term,
      fields: 'phone',
      exact_match: 'true',
      limit: '10',
    });
    const res = await fetchImpl(`${apiDomain}/api/v1/persons/search?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Pipedrive persons/search returned ${res.status}`);
    }
    const body = await res.json();
    return (body && body.data && body.data.items) || [];
  }

  /**
   * Find the first person matching any variant of the number.
   * @returns {Promise<{personId, name, phones, orgId}|null>}
   */
  async function searchPersonByPhone(apiDomain, accessToken, number) {
    for (const term of variants(number)) {
      if (term.length < 2) continue; // Pipedrive requires >=2 chars (1 with exact_match)
      const items = await searchByTerm(apiDomain, accessToken, term);
      if (items.length > 0) {
        const it = items[0].item || {};
        return {
          personId: it.id,
          name: it.name,
          phones: it.phones || [],
          orgId: it.organization ? it.organization.id : null,
        };
      }
    }
    return null;
  }

  /**
   * Create a person with a phone number (used for unknown callers).
   * @returns {Promise<{personId: number}>}
   */
  async function createPerson(apiDomain, accessToken, { name, phone }) {
    const res = await fetchImpl(`${apiDomain}/api/v1/persons`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || phone,
        phone: phone ? [{ value: phone, primary: true, label: 'work' }] : undefined,
      }),
    });
    if (!res.ok) {
      throw new Error(`Pipedrive persons create returned ${res.status}`);
    }
    const body = await res.json();
    const d = (body && body.data) || {};
    return { personId: d.id };
  }

  return { searchByTerm, searchPersonByPhone, createPerson };
}

module.exports = { createPersonsClient };

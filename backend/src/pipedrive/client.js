'use strict';

// Pipedrive REST client. All calls go to the company-specific `api_domain`
// returned by the OAuth token response, with a Bearer access token.
// Responses use the {success, data, ...} envelope — we unwrap `data`.

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createPipedriveClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  async function get(apiDomain, accessToken, path) {
    const res = await fetchImpl(`${apiDomain}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Pipedrive GET ${path} returned ${res.status}`);
    }
    return res.json();
  }

  /**
   * GET /api/v1/users/me — the authorised user plus bound company info.
   * @returns {Promise<{id, name, companyId: string, companyName, companyDomain}>}
   */
  async function getCurrentUser(apiDomain, accessToken) {
    const body = await get(apiDomain, accessToken, '/api/v1/users/me');
    const d = (body && body.data) || {};
    return {
      id: d.id,
      name: d.name,
      companyId: d.company_id != null ? String(d.company_id) : null,
      companyName: d.company_name,
      companyDomain: d.company_domain,
    };
  }

  /**
   * GET /api/v1/users — list the company's users (for the DID/extension mapping page).
   * @returns {Promise<Array<{id, name, email, active}>>}
   */
  async function listUsers(apiDomain, accessToken) {
    const body = await get(apiDomain, accessToken, '/api/v1/users');
    const arr = (body && body.data) || [];
    return arr.map((u) => ({ id: u.id, name: u.name, email: u.email, active: u.active_flag }));
  }

  /**
   * GET /api/v1/persons/{id} — fetch a person's name + phone numbers (panel call buttons).
   * @returns {Promise<{id, name, phones: string[]}>}
   */
  async function getPerson(apiDomain, accessToken, personId) {
    const body = await get(apiDomain, accessToken, `/api/v1/persons/${personId}`);
    const d = (body && body.data) || {};
    const phones = Array.isArray(d.phone) ? d.phone.map((p) => p.value).filter(Boolean) : [];
    return { id: d.id, name: d.name, phones };
  }

  return { getCurrentUser, listUsers, getPerson };
}

module.exports = { createPipedriveClient };

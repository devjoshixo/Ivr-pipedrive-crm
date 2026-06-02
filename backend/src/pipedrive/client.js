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

  return { getCurrentUser };
}

module.exports = { createPipedriveClient };

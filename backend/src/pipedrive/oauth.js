'use strict';

// Pipedrive OAuth 2.0 authorization-code client. Endpoints (live docs 2025-2026):
//   authorize: GET  https://oauth.pipedrive.com/oauth/authorize
//   token:     POST https://oauth.pipedrive.com/oauth/token   (HTTP Basic auth)
// Scopes are configured in the Developer Hub, NOT passed in the authorize URL.

const OAUTH_BASE = 'https://oauth.pipedrive.com';

/**
 * @param {{clientId: string, redirectUri: string, state: string}} params
 * @returns {string}
 */
function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${OAUTH_BASE}/oauth/authorize?${qs.toString()}`;
}

/**
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createOAuthClient({ clientId, clientSecret, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  const basicAuth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  async function token(params) {
    const res = await fetchImpl(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      throw new Error(`Pipedrive token endpoint returned ${res.status}`);
    }
    return res.json();
  }

  /**
   * Exchange an authorization code (valid 5 min) for tokens.
   * @returns {Promise<object>} {access_token, refresh_token, token_type, scope, expires_in, api_domain}
   */
  function exchangeCode(code, redirectUri) {
    return token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  /**
   * Refresh an access token. The refresh token has a 60-day sliding expiry.
   * @returns {Promise<object>} same shape as exchangeCode
   */
  function refreshToken(refreshTokenValue) {
    return token({ grant_type: 'refresh_token', refresh_token: refreshTokenValue });
  }

  return { exchangeCode, refreshToken };
}

module.exports = { buildAuthorizeUrl, createOAuthClient, OAUTH_BASE };

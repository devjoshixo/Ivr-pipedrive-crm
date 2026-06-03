'use strict';

// Returns a usable Pipedrive access token for a company, refreshing transparently
// when it has expired (or is about to). Refresh tokens have a 60-day sliding
// expiry, so any active company stays connected without a re-auth prompt.

const REFRESH_BUFFER_MS = 60 * 1000; // refresh 60s before actual expiry

/**
 * @param {object} deps
 * @param {{getInstall: Function, savePipedriveTokens: Function}} deps.installStore
 * @param {{refreshToken: Function}} deps.oauthClient
 * @param {() => number} [deps.now]
 */
function createTokenService({ installStore, oauthClient, now = Date.now }) {
  /**
   * @param {string} companyId
   * @param {object} [opts]
   * @param {boolean} [opts.forceRefresh] - refresh even if the cached token looks valid
   *   (used to self-heal a token that was revoked before its expiry, e.g. after re-auth)
   * @returns {Promise<{accessToken: string, apiDomain: string}>}
   */
  async function getAccessToken(companyId, { forceRefresh = false } = {}) {
    const install = await installStore.getInstall(companyId);
    if (!install || !install.pd_refresh_token) {
      throw new Error(`Company ${companyId} is not connected to Pipedrive`);
    }

    const expiresAtMs = install.pd_token_expires_at
      ? new Date(install.pd_token_expires_at).getTime()
      : 0;
    const stillValid =
      !forceRefresh && install.pd_access_token && expiresAtMs - now() > REFRESH_BUFFER_MS;
    if (stillValid) {
      return { accessToken: install.pd_access_token, apiDomain: install.pd_api_domain };
    }

    const tok = await oauthClient.refreshToken(install.pd_refresh_token);
    const apiDomain = tok.api_domain || install.pd_api_domain;
    const expiresAt = new Date(now() + Number(tok.expires_in) * 1000);
    await installStore.savePipedriveTokens(companyId, {
      companyDomain: install.company_domain,
      apiDomain,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      scope: tok.scope,
      expiresAt,
    });
    return { accessToken: tok.access_token, apiDomain };
  }

  return { getAccessToken };
}

module.exports = { createTokenService };

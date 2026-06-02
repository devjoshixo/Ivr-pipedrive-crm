'use strict';

// Pipedrive OAuth routes:
//   GET /oauth/install   -> redirect the admin to Pipedrive's consent screen
//   GET /oauth/callback  -> exchange the code, resolve the company, store tokens
//
// The `state` parameter is a signed token (no server-side session needed); it is
// verified on callback to prevent CSRF.

const express = require('express');
const { buildAuthorizeUrl } = require('../pipedrive/oauth');
const { createState, verifyState } = require('../pipedrive/state');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {{exchangeCode: Function}} deps.oauthClient
 * @param {{getCurrentUser: Function}} deps.pipedriveClient
 * @param {{savePipedriveTokens: Function}} deps.installStore
 */
function createOAuthRouter({ config, oauthClient, pipedriveClient, installStore }) {
  const router = express.Router();
  const { clientId, redirectUri } = config.pipedrive;
  const stateSecret = config.oauthStateSecret;

  // Start the flow.
  router.get('/install', (req, res) => {
    if (!clientId || !redirectUri) {
      return res.status(503).send('Pipedrive OAuth is not configured');
    }
    const state = createState(stateSecret);
    return res.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }));
  });

  // Handle the redirect back from Pipedrive.
  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) {
      return res.status(400).send(`Authorization was denied: ${escapeHtml(error)}`);
    }
    if (!code || !verifyState(stateSecret, state)) {
      return res.status(400).send('Invalid or expired OAuth state. Please retry the install.');
    }
    try {
      const tok = await oauthClient.exchangeCode(String(code), redirectUri);
      const me = await pipedriveClient.getCurrentUser(tok.api_domain, tok.access_token);
      if (!me.companyId) {
        return res.status(502).send('Could not resolve the Pipedrive company for this install.');
      }
      const expiresAt = new Date(Date.now() + Number(tok.expires_in) * 1000);
      await installStore.savePipedriveTokens(me.companyId, {
        companyDomain: me.companyDomain,
        apiDomain: tok.api_domain,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        scope: tok.scope,
        expiresAt,
      });
      // Land the admin on the settings page with their company context.
      return res.redirect(`/settings.html?company_id=${encodeURIComponent(me.companyId)}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('OAuth callback failed:', err.message);
      return res.status(502).send('Could not complete the Pipedrive authorization.');
    }
  });

  return router;
}

module.exports = { createOAuthRouter };

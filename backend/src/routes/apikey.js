'use strict';

// API key management for the dashboard (SDK-token auth only — a customer admin
// inside Pipedrive generates the key, then pastes it into the FoundersCart website
// for server-to-server access). The raw key is returned exactly once on regenerate.

const express = require('express');
const { identityFromRequest } = require('../pipedrive/requestAuth');

const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {{regenerate: Function, getMeta: Function}} deps.apiKeyStore
 */
function createApiKeyRouter({ config, apiKeyStore }) {
  const router = express.Router();
  const jwtSecret = config.pipedrive.jwtSecret || config.pipedrive.clientSecret;

  // Intentionally SDK-token only (never API-key) so a key can't mint another key.
  function companyFromRequest(req) {
    return identityFromRequest(req, jwtSecret).companyId;
  }

  // Non-secret metadata (prefix + timestamps) for display.
  router.get('/', async (req, res) => {
    let companyId;
    try {
      companyId = companyFromRequest(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    try {
      const meta = await apiKeyStore.getMeta(companyId);
      return res.json(ok({ key: meta }));
    } catch {
      return res.status(502).json(fail('Could not read the API key'));
    }
  });

  // Generate (or replace) the key. Returns the raw key once.
  router.post('/regenerate', async (req, res) => {
    let companyId;
    try {
      companyId = companyFromRequest(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    try {
      const { key, prefix } = await apiKeyStore.regenerate(companyId);
      return res.json(ok({ key, prefix }));
    } catch {
      return res.status(502).json(fail('Could not generate the API key'));
    }
  });

  return router;
}

module.exports = { createApiKeyRouter };

'use strict';

// Settings routes — the milestone-1 slice: validate an IVR token against the live
// IVR API, and (optionally) save it sealed in Postgres.
//
// The browser settings page calls THIS backend, never the IVR API directly, so the
// token is validated/stored server-side and never exposed in iframe code.

const express = require('express');

// Consistent API envelope (see common/patterns.md).
const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {{validateToken: Function}} deps.ivrClient
 * @param {{saveIvrToken: Function}} [deps.installStore] - omitted in the no-DB slice
 */
function createSettingsRouter({ ivrClient, installStore }) {
  const router = express.Router();

  // POST /api/settings/validate-token  { token }
  router.post('/validate-token', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      return res.status(400).json(fail('Token is required'));
    }
    try {
      const valid = await ivrClient.validateToken(token);
      return res.json(ok({ valid }));
    } catch {
      return res.status(502).json(fail('Could not reach the IVR API'));
    }
  });

  // POST /api/settings/save-token  { token, companyId }
  // Validates first, then persists sealed. Requires the DB store to be wired.
  router.post('/save-token', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
    if (!token || !companyId) {
      return res.status(400).json(fail('token and companyId are required'));
    }
    if (!installStore) {
      return res.status(503).json(fail('Persistence is not configured'));
    }
    try {
      const valid = await ivrClient.validateToken(token);
      if (!valid) {
        return res.status(422).json(fail('Token rejected by the IVR API'));
      }
      await installStore.saveIvrToken(companyId, token, true);
      return res.json(ok({ saved: true, valid: true }));
    } catch {
      return res.status(502).json(fail('Could not validate or save the token'));
    }
  });

  return router;
}

module.exports = { createSettingsRouter };

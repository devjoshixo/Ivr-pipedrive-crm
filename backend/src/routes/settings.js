'use strict';

// Settings routes — the milestone-1 slice: validate an IVR token against the live
// IVR API, and (optionally) save it sealed in Postgres.
//
// The browser settings page calls THIS backend, never the IVR API directly, so the
// token is validated/stored server-side and never exposed in iframe code.

const express = require('express');
const { verifySignedToken } = require('../pipedrive/jwt');

// Consistent API envelope (see common/patterns.md).
const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {{validateToken: Function}} deps.ivrClient
 * @param {{saveIvrToken: Function}} [deps.installStore] - omitted in the no-DB slice
 * @param {object} [deps.config] - for verifying the SDK signed token on save
 */
function createSettingsRouter({ ivrClient, installStore, config }) {
  const router = express.Router();
  const jwtSecret = config && config.pipedrive && (config.pipedrive.jwtSecret || config.pipedrive.clientSecret);

  // Resolve the company: prefer the verified SDK signed token (Authorization header,
  // used when the page runs inside Pipedrive); fall back to the companyId in the body
  // (the standalone post-OAuth redirect flow).
  function resolveCompanyId(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token && jwtSecret) {
      try {
        const claims = verifySignedToken(token, jwtSecret);
        const id = claims.companyId ?? claims.company_id;
        if (id != null) return String(id);
      } catch {
        /* fall through to body */
      }
    }
    return typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
  }

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

  // POST /api/settings/save-token  { token }  (company from SDK token or body fallback)
  // Validates first, then persists sealed. Requires the DB store to be wired.
  router.post('/save-token', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const companyId = resolveCompanyId(req);
    if (!token) {
      return res.status(400).json(fail('token is required'));
    }
    if (!companyId) {
      return res.status(401).json(fail('Could not resolve the company (open inside Pipedrive)'));
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

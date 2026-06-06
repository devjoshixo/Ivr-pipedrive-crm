'use strict';

// Settings routes — the milestone-1 slice: validate an IVR token against the live
// IVR API, and (optionally) save it sealed in MariaDB/MySQL.
//
// The browser settings page calls THIS backend, never the IVR API directly, so the
// token is validated/stored server-side and never exposed in iframe code.

const express = require('express');
const { z } = require('zod');
const { verifySignedToken } = require('../pipedrive/jwt');
const { validateBody } = require('../middleware/validate');

// Consistent API envelope (see common/patterns.md).
const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

const validateTokenSchema = z.object({ token: z.string().trim().min(1, 'is required') });
const saveTokenSchema = z.object({
  token: z.string().trim().min(1, 'is required'),
  companyId: z.string().optional(),
});

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

  // GET /api/settings/client-config — public, non-secret front-end config (the
  // companion Chrome extension install URL). No auth: it's just a public URL.
  router.get('/client-config', (req, res) => {
    res.json(ok({ chromeExtensionUrl: (config && config.chromeExtensionUrl) || '' }));
  });

  // POST /api/settings/validate-token  { token }
  router.post('/validate-token', validateBody(validateTokenSchema), async (req, res) => {
    const token = req.body.token;
    try {
      const valid = await ivrClient.validateToken(token);
      return res.json(ok({ valid }));
    } catch {
      return res.status(502).json(fail('Could not reach the IVR API'));
    }
  });

  // POST /api/settings/save-token  { token }  (company from SDK token or body fallback)
  // Validates first, then persists sealed. Requires the DB store to be wired.
  router.post('/save-token', validateBody(saveTokenSchema), async (req, res) => {
    const token = req.body.token;
    const companyId = resolveCompanyId(req);
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

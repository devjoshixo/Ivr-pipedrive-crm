'use strict';

// CTI support endpoints for the floating-window softphone host.
//   GET /api/cti/lookup?number=<phone>   -> { match: {personId, name, orgId} | null }
//
// Authentication: a Pipedrive signed JWT (from the SDK's GET_SIGNED_TOKEN) in the
// Authorization header. The company is taken from the verified token's claims, never
// trusted from the query string.

const express = require('express');
const { verifySignedToken } = require('../pipedrive/jwt');

const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {{getAccessToken: Function}} deps.tokenService
 * @param {{searchPersonByPhone: Function}} deps.personsClient
 */
function createCtiRouter({ config, tokenService, personsClient }) {
  const router = express.Router();
  const jwtSecret = config.pipedrive.jwtSecret || config.pipedrive.clientSecret;

  function companyFromRequest(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const claims = verifySignedToken(token, jwtSecret);
    const companyId = claims.companyId ?? claims.company_id;
    if (companyId == null) throw new Error('No company in token');
    return String(companyId);
  }

  router.get('/lookup', async (req, res) => {
    const number = String(req.query.number || '').trim();
    if (!number) {
      return res.status(400).json(fail('number is required'));
    }
    let companyId;
    try {
      companyId = companyFromRequest(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    try {
      const { accessToken, apiDomain } = await tokenService.getAccessToken(companyId);
      const match = await personsClient.searchPersonByPhone(apiDomain, accessToken, number);
      return res.json(ok({ match }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('CTI lookup failed:', err.message);
      return res.status(502).json(fail('Lookup failed'));
    }
  });

  return router;
}

module.exports = { createCtiRouter };

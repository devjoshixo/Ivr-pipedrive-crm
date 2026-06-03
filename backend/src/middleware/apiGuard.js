'use strict';

// Router middleware: resolves identity (API key or SDK token), sets req.ivrIdentity,
// and applies the per-company rate limit. Handlers then read req.ivrIdentity instead
// of re-parsing auth.

const { resolveIdentity } = require('../pipedrive/requestAuth');

const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {string} deps.jwtSecret
 * @param {{resolveCompany: Function}} [deps.apiKeyStore]
 * @param {{take: Function}} [deps.limiter]
 */
function createApiGuard({ jwtSecret, apiKeyStore, limiter }) {
  return async function apiGuard(req, res, next) {
    let identity;
    try {
      identity = await resolveIdentity(req, { jwtSecret, apiKeyStore });
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    req.ivrIdentity = identity;

    if (limiter) {
      const r = limiter.take(identity.companyId);
      if (!r.allowed) {
        res.set('Retry-After', String(Math.ceil(r.retryAfterMs / 1000)));
        return res.status(429).json(fail('Rate limit exceeded — slow down'));
      }
    }
    return next();
  };
}

module.exports = { createApiGuard };

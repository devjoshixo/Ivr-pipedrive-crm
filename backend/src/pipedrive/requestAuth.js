'use strict';

// Extract the verified company + user from an App Extensions SDK signed token on a
// request. Throws if the token is missing/invalid. Used by the SDK-authenticated routes.

const { verifySignedToken } = require('./jwt');

/**
 * @param {import('express').Request} req
 * @param {string} jwtSecret
 * @returns {{companyId: string, userId: string|null, claims: object}}
 */
function identityFromRequest(req, jwtSecret) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = verifySignedToken(token, jwtSecret); // throws on invalid/expired
  const companyId = claims.companyId ?? claims.company_id;
  if (companyId == null) throw new Error('No company in token');
  const userId = claims.userId ?? claims.user_id ?? claims.uid ?? claims.sub;
  return {
    companyId: String(companyId),
    userId: userId != null ? String(userId) : null,
    claims,
  };
}

module.exports = { identityFromRequest };

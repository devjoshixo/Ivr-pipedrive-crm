'use strict';

// Minimal HS256 JWT verification for the tokens issued by the App Extensions SDK's
// GET_SIGNED_TOKEN command (valid 5 min, signed with the app's JWT secret which
// defaults to the client secret). No external dependency — node:crypto only.

const crypto = require('node:crypto');

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/**
 * Verify a signed token and return its claims. Throws on any failure.
 * @param {string} token
 * @param {string} secret
 * @param {object} [opts]
 * @param {number} [opts.nowSec] - injectable clock (seconds)
 * @returns {object} claims
 */
function verifySignedToken(token, secret, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Missing token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }
  const [headerB64, payloadB64, sig] = parts;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid signature');
  }

  let header;
  let payload;
  try {
    header = decodeSegment(headerB64);
    payload = decodeSegment(payloadB64);
  } catch {
    throw new Error('Malformed token segments');
  }
  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported alg: ${header.alg}`);
  }
  if (payload.exp && nowSec > Number(payload.exp)) {
    throw new Error('Token expired');
  }
  return payload;
}

module.exports = { verifySignedToken };

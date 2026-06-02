'use strict';

// Stateless, signed OAuth `state` parameter for CSRF protection. Format:
//   "<nonce>.<timestampMs>.<hmac-sha256(nonce.timestampMs)>"
// No server-side storage needed — the HMAC proves we issued it, the timestamp
// bounds its lifetime. (See common/security.md — CSRF protection on OAuth.)

const crypto = require('node:crypto');

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * @param {string} secret
 * @param {number} [nowMs] - injectable clock for testing
 * @returns {string}
 */
function createState(secret, nowMs = Date.now()) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const payload = `${nonce}.${nowMs}`;
  return `${payload}.${sign(secret, payload)}`;
}

/**
 * @param {string} secret
 * @param {string} state
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs]
 * @param {number} [opts.nowMs]
 * @returns {boolean}
 */
function verifyState(secret, state, { maxAgeMs = DEFAULT_MAX_AGE_MS, nowMs = Date.now() } = {}) {
  if (typeof state !== 'string') return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  const payload = `${nonce}.${ts}`;
  const expected = sign(secret, payload);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }
  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return false;
  return nowMs - issuedAt <= maxAgeMs && nowMs - issuedAt >= 0;
}

module.exports = { createState, verifyState };

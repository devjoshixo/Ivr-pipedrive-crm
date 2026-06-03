'use strict';

// Per-company API keys for server-to-server access (e.g. the FoundersCart website
// calling our Pipedrive APIs on a customer's behalf). The raw key is shown to the
// admin once; only its SHA-256 hash is stored.

const crypto = require('node:crypto');

const API_KEY_PREFIX = 'ivrpd_';

/**
 * @returns {{key: string, hash: string, prefix: string}}
 */
function generateApiKey() {
  const secret = crypto.randomBytes(24).toString('base64url'); // 32 url-safe chars
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) };
}

/**
 * @param {string} key
 * @returns {string} sha256 hex
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

module.exports = { generateApiKey, hashApiKey, API_KEY_PREFIX };

'use strict';

// AES-256-GCM sealing for the IVR API token at rest.
// Sealed payload format: "<iv-b64>:<authTag-b64>:<ciphertext-b64>".
// The token is NEVER stored or logged in plaintext (see common/security.md).

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

/**
 * Decode an env-provided key (hex or base64) into a 32-byte Buffer.
 * @param {string} value
 * @returns {Buffer}
 */
function keyFromEnv(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Encryption key must be a non-empty string');
  }
  const isHex = /^[0-9a-fA-F]+$/.test(value) && value.length === KEY_BYTES * 2;
  const buf = isHex ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`Encryption key must decode to ${KEY_BYTES} bytes (got ${buf.length})`);
  }
  return buf;
}

/**
 * Encrypt plaintext with the given 32-byte key.
 * @param {string} plaintext
 * @param {Buffer} key
 * @returns {string} sealed payload
 */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

/**
 * Decrypt a sealed payload. Throws if the key is wrong or the data was tampered.
 * @param {string} payload
 * @param {Buffer} key
 * @returns {string} plaintext
 */
function decrypt(payload, key) {
  if (typeof payload !== 'string') {
    throw new Error('Sealed payload must be a string');
  }
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Sealed payload is malformed');
  }
  const [iv, authTag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, keyFromEnv };

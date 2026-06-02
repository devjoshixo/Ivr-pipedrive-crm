'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { encrypt, decrypt, keyFromEnv } = require('../src/crypto');

// A deterministic 32-byte key for tests (hex form).
const KEY_HEX = crypto.randomBytes(32).toString('hex');
const key = keyFromEnv(KEY_HEX);

test('keyFromEnv accepts 64-char hex and 32-byte base64', () => {
  const hexKey = keyFromEnv(crypto.randomBytes(32).toString('hex'));
  const b64Key = keyFromEnv(crypto.randomBytes(32).toString('base64'));
  assert.equal(hexKey.length, 32);
  assert.equal(b64Key.length, 32);
});

test('keyFromEnv rejects wrong-length keys', () => {
  assert.throws(() => keyFromEnv('tooshort'), /32 bytes/);
});

test('encrypt then decrypt round-trips the plaintext', () => {
  const secret = 'sample-ivr-api-token-value-for-tests';
  const sealed = encrypt(secret, key);
  assert.notEqual(sealed, secret, 'ciphertext must differ from plaintext');
  assert.equal(decrypt(sealed, key), secret);
});

test('encrypt uses a fresh IV each call (non-deterministic output)', () => {
  const a = encrypt('same-input', key);
  const b = encrypt('same-input', key);
  assert.notEqual(a, b, 'two encryptions of the same value must differ');
  assert.equal(decrypt(a, key), 'same-input');
  assert.equal(decrypt(b, key), 'same-input');
});

test('decrypt rejects a tampered ciphertext (auth tag mismatch)', () => {
  const sealed = encrypt('do-not-tamper', key);
  const parts = sealed.split(':');
  // Flip a byte in the ciphertext segment.
  const tampered = Buffer.from(parts[2], 'base64');
  tampered[0] = tampered[0] ^ 0xff;
  parts[2] = tampered.toString('base64');
  assert.throws(() => decrypt(parts.join(':'), key));
});

test('decrypt rejects a wrong key', () => {
  const sealed = encrypt('secret', key);
  const otherKey = keyFromEnv(crypto.randomBytes(32).toString('hex'));
  assert.throws(() => decrypt(sealed, otherKey));
});

test('decrypt rejects a malformed payload', () => {
  assert.throws(() => decrypt('not-a-valid-payload', key), /malformed/);
});

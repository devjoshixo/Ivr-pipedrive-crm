'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateApiKey, hashApiKey, API_KEY_PREFIX } = require('../src/apikey');

test('generateApiKey returns a prefixed key, its sha256 hash, and a display prefix', () => {
  const { key, hash, prefix } = generateApiKey();
  assert.ok(key.startsWith(API_KEY_PREFIX), 'key is prefixed');
  assert.equal(hash, hashApiKey(key), 'hash matches hashApiKey(key)');
  assert.equal(hash.length, 64, 'sha256 hex');
  assert.ok(key.startsWith(prefix), 'prefix is a leading slice of the key');
  assert.ok(prefix.length >= 8 && prefix.length < key.length);
});

test('two generated keys differ', () => {
  assert.notEqual(generateApiKey().key, generateApiKey().key);
});

test('hashApiKey is deterministic and never returns the raw key', () => {
  const { key } = generateApiKey();
  assert.equal(hashApiKey(key), hashApiKey(key));
  assert.notEqual(hashApiKey(key), key);
});

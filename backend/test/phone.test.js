'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { digitsOnly, lastTen, variants } = require('../src/phone');

test('digitsOnly strips all non-digit characters', () => {
  assert.equal(digitsOnly('+91 (987) 654-3210'), '919876543210');
  assert.equal(digitsOnly(''), '');
  assert.equal(digitsOnly(null), '');
});

test('lastTen returns the last 10 digits', () => {
  assert.equal(lastTen('919876543210'), '9876543210');
  assert.equal(lastTen('9876543210'), '9876543210');
  assert.equal(lastTen('12345'), '12345');
});

test('variants includes raw, all-digits, E.164, and India-formatted forms', () => {
  const v = variants('+91 98765-43210');
  assert.ok(v.includes('+91 98765-43210'), 'keeps the raw trimmed input');
  assert.ok(v.includes('919876543210'), 'all digits');
  assert.ok(v.includes('+919876543210'), 'E.164');
  assert.ok(v.includes('9876543210'), 'local 10-digit');
  assert.ok(v.includes('919876543210'), '91-prefixed');
  assert.ok(v.includes('+919876543210'), '+91-prefixed');
  assert.ok(v.includes('09876543210'), '0-prefixed');
});

test('variants de-duplicates and handles a bare 10-digit number', () => {
  const v = variants('9876543210');
  assert.equal(new Set(v).size, v.length, 'no duplicates');
  assert.ok(v.includes('9876543210'));
  assert.ok(v.includes('919876543210'));
});

test('variants returns empty for blank input', () => {
  assert.deepEqual(variants(''), []);
  assert.deepEqual(variants(null), []);
});

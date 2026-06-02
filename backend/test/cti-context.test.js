'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The helper is a browser ESM module with no SDK/DOM deps — import it dynamically.
const modUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'js', 'cti-context.mjs')
).href;

test('extractNumberFromContext reads common context shapes', async () => {
  const { extractNumberFromContext } = await import(modUrl);

  assert.equal(extractNumberFromContext({ number: '123' }), '123');
  assert.equal(extractNumberFromContext({ phone: '456' }), '456');
  assert.equal(extractNumberFromContext({ phoneNumber: '789' }), '789');
  assert.equal(extractNumberFromContext({ call: { number: '111' } }), '111');
  assert.equal(extractNumberFromContext({ data: { phone: '222' } }), '222');
});

test('extractNumberFromContext returns null when no number is present', async () => {
  const { extractNumberFromContext } = await import(modUrl);
  assert.equal(extractNumberFromContext(null), null);
  assert.equal(extractNumberFromContext(undefined), null);
  assert.equal(extractNumberFromContext({}), null);
  assert.equal(extractNumberFromContext({ unrelated: 'x' }), null);
});

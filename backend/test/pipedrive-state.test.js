'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createState, verifyState } = require('../src/pipedrive/state');

const SECRET = 'test-state-secret';

test('createState then verifyState round-trips', () => {
  const state = createState(SECRET);
  assert.equal(verifyState(SECRET, state), true);
});

test('verifyState rejects a tampered state', () => {
  const state = createState(SECRET);
  const tampered = state.slice(0, -2) + (state.slice(-1) === 'a' ? 'b' : 'a');
  assert.equal(verifyState(SECRET, tampered), false);
});

test('verifyState rejects a state signed with a different secret', () => {
  const state = createState(SECRET);
  assert.equal(verifyState('other-secret', state), false);
});

test('verifyState rejects an expired state', () => {
  const t0 = 1_000_000_000_000;
  const state = createState(SECRET, t0);
  // 11 minutes later, default max age is 10 minutes.
  assert.equal(verifyState(SECRET, state, { nowMs: t0 + 11 * 60 * 1000 }), false);
  assert.equal(verifyState(SECRET, state, { nowMs: t0 + 9 * 60 * 1000 }), true);
});

test('verifyState rejects malformed input', () => {
  assert.equal(verifyState(SECRET, ''), false);
  assert.equal(verifyState(SECRET, 'not-a-real-state'), false);
  assert.equal(verifyState(SECRET, undefined), false);
});

test('two states are unique (fresh nonce each call)', () => {
  assert.notEqual(createState(SECRET, 123), createState(SECRET, 123));
});

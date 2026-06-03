'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../src/middleware/rateLimit');

test('allows up to max requests in a window, then blocks', () => {
  let t = 1000;
  const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
  assert.equal(rl.take('c1').allowed, true);
  assert.equal(rl.take('c1').allowed, true);
  assert.equal(rl.take('c1').allowed, true);
  const blocked = rl.take('c1');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('resets after the window elapses', () => {
  let t = 1000;
  const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  rl.take('c1');
  rl.take('c1');
  assert.equal(rl.take('c1').allowed, false);
  t += 1001; // window passed
  assert.equal(rl.take('c1').allowed, true);
});

test('limits are independent per company', () => {
  let t = 1000;
  const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
  assert.equal(rl.take('c1').allowed, true);
  assert.equal(rl.take('c1').allowed, false);
  assert.equal(rl.take('c2').allowed, true, 'c2 has its own bucket');
});

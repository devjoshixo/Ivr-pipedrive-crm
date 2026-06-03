'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRetryingFetch } = require('../src/util/fetchRetry');

function res(status, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] } };
}

// Scripted fetch returning a sequence of statuses.
function scripted(statuses) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return statuses[Math.min(i++, statuses.length - 1)];
  };
  return { fetchImpl, calls };
}

// No-op sleep that records requested delays instead of waiting.
function fakeSleep() {
  const delays = [];
  return { sleep: async (ms) => { delays.push(ms); }, delays };
}

test('returns immediately on a 2xx', async () => {
  const { fetchImpl, calls } = scripted([res(200)]);
  const { sleep, delays } = fakeSleep();
  const f = createRetryingFetch({ fetchImpl, sleep });
  const r = await f('http://x');
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(delays.length, 0);
});

test('retries on 429 then succeeds', async () => {
  const { fetchImpl, calls } = scripted([res(429), res(429), res(200)]);
  const { sleep, delays } = fakeSleep();
  const f = createRetryingFetch({ fetchImpl, sleep, baseDelayMs: 100 });
  const r = await f('http://x');
  assert.equal(r.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(delays.length, 2); // two backoff waits
  assert.ok(delays[1] > delays[0], 'exponential backoff increases');
});

test('honors Retry-After header (seconds) when present', async () => {
  const { fetchImpl } = scripted([res(429, { 'retry-after': '2' }), res(200)]);
  const { sleep, delays } = fakeSleep();
  const f = createRetryingFetch({ fetchImpl, sleep });
  await f('http://x');
  assert.equal(delays[0], 2000);
});

test('retries on 5xx', async () => {
  const { fetchImpl, calls } = scripted([res(503), res(200)]);
  const { sleep } = fakeSleep();
  const f = createRetryingFetch({ fetchImpl, sleep });
  const r = await f('http://x');
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2);
});

test('does NOT retry on 4xx other than 429', async () => {
  const { fetchImpl, calls } = scripted([res(400), res(200)]);
  const { sleep } = fakeSleep();
  const f = createRetryingFetch({ fetchImpl, sleep });
  const r = await f('http://x');
  assert.equal(r.status, 400);
  assert.equal(calls.length, 1);
});

test('gives up after maxRetries and returns the last response', async () => {
  const { fetchImpl, calls } = scripted([res(429)]);
  const { sleep } = fakeSleep();
  const f = createRetryingFetch({ fetchImpl, sleep, maxRetries: 3 });
  const r = await f('http://x');
  assert.equal(r.status, 429);
  assert.equal(calls.length, 4); // initial + 3 retries
});

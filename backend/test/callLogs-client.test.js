'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCallLogsClient } = require('../src/pipedrive/callLogs');

function fakeFetch(responseBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: async () => responseBody };
  };
  return { fetchImpl, calls };
}

test('createCallLog POSTs to /api/v1/callLogs with Bearer + JSON and returns data', async () => {
  const { fetchImpl, calls } = fakeFetch({ success: true, data: { id: 'cl-1' } });
  const client = createCallLogsClient({ fetchImpl });

  const payload = { outcome: 'connected', to_phone_number: '9876543210', start_time: 'x', end_time: 'y' };
  const result = await client.createCallLog('https://acme.pipedrive.com', 'tok', payload);

  assert.equal(result.id, 'cl-1');
  assert.equal(calls[0].url, 'https://acme.pipedrive.com/api/v1/callLogs');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
});

test('createCallLog throws on a non-2xx response', async () => {
  const { fetchImpl } = fakeFetch({ success: false }, { ok: false, status: 400 });
  const client = createCallLogsClient({ fetchImpl });
  await assert.rejects(
    () => client.createCallLog('https://acme.pipedrive.com', 'tok', {}),
    /400/
  );
});

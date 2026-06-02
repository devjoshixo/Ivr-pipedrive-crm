'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createIvrClient, DEFAULT_BASE_URL } = require('../src/ivr/client');

// Build a fake fetch that records the call and returns a canned JSON body.
function fakeFetch(responseBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok,
      status,
      json: async () => responseBody,
    };
  };
  return { fetchImpl, calls };
}

test('validateToken posts to /api/key_authentication with Bearer header and {} body', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 200 });
  const client = createIvrClient({ fetchImpl });

  const valid = await client.validateToken('test-token');

  assert.equal(valid, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${DEFAULT_BASE_URL}/api/key_authentication`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.body, '{}');
});

test('validateToken returns false when the API reports status 401', async () => {
  const { fetchImpl } = fakeFetch({ status: 401 });
  const client = createIvrClient({ fetchImpl });
  assert.equal(await client.validateToken('bad-token'), false);
});

test('validateToken returns false on a non-200 HTTP response', async () => {
  const { fetchImpl } = fakeFetch({}, { ok: false, status: 500 });
  const client = createIvrClient({ fetchImpl });
  assert.equal(await client.validateToken('any'), false);
});

test('validateToken returns false when fetch throws (network error)', async () => {
  const client = createIvrClient({
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(await client.validateToken('any'), false);
});

test('fetchAllCallLogs sends the three cursors and returns the parsed body', async () => {
  const body = {
    status: 200,
    call_logs: [{ recordid: '101' }],
    click_to_call_logs: [],
    dialer_logs: [],
  };
  const { fetchImpl, calls } = fakeFetch(body);
  const client = createIvrClient({ fetchImpl });

  const result = await client.fetchAllCallLogs('tok', {
    lastCallLogId: '100',
    lastC2cLogId: '',
    lastDialerLogId: '',
  });

  assert.deepEqual(result, body);
  assert.equal(calls[0].url, `${DEFAULT_BASE_URL}/v1/all_call_logs`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    last_call_log_id: '100',
    last_c2c_log_id: '',
    last_dialer_log_id: '',
  });
});

test('fetchAllCallLogs defaults missing cursors to empty strings', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 200 });
  const client = createIvrClient({ fetchImpl });
  await client.fetchAllCallLogs('tok', {});
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    last_call_log_id: '',
    last_c2c_log_id: '',
    last_dialer_log_id: '',
  });
});

test('triggerClickToCall builds the c2c_get query string', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 200, recordid: 'abc' });
  const client = createIvrClient({ fetchImpl });

  const res = await client.triggerClickToCall('tok', {
    did: '+12025551234',
    extNo: '201',
    phone: '9876543210',
  });

  assert.equal(res.recordid, 'abc');
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, '/v1/c2c_get');
  assert.equal(u.searchParams.get('token'), 'tok');
  assert.equal(u.searchParams.get('did'), '+12025551234');
  assert.equal(u.searchParams.get('ext_no'), '201');
  assert.equal(u.searchParams.get('phone'), '9876543210');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPipedriveClient } = require('../src/pipedrive/client');

function fakeFetch(responseBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: async () => responseBody };
  };
  return { fetchImpl, calls };
}

test('getCurrentUser calls api_domain/api/v1/users/me with Bearer and unwraps the envelope', async () => {
  const { fetchImpl, calls } = fakeFetch({
    success: true,
    data: {
      id: 42,
      name: 'Agent Smith',
      company_id: 9001,
      company_name: 'Acme Corp',
      company_domain: 'acme',
    },
  });
  const client = createPipedriveClient({ fetchImpl });

  const me = await client.getCurrentUser('https://acme.pipedrive.com', 'access-tok');

  assert.equal(calls[0].url, 'https://acme.pipedrive.com/api/v1/users/me');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer access-tok');
  assert.deepEqual(me, {
    id: 42,
    name: 'Agent Smith',
    companyId: '9001', // normalised to string (used as our install primary key)
    companyName: 'Acme Corp',
    companyDomain: 'acme',
  });
});

test('listUsers maps id/name/email/active from /api/v1/users', async () => {
  const { fetchImpl, calls } = fakeFetch({
    success: true,
    data: [
      { id: 1, name: 'Agent One', email: 'a@x.com', active_flag: true },
      { id: 2, name: 'Agent Two', email: 'b@x.com', active_flag: false },
    ],
  });
  const client = createPipedriveClient({ fetchImpl });
  const users = await client.listUsers('https://acme.pipedrive.com', 'tok');
  assert.equal(calls[0].url, 'https://acme.pipedrive.com/api/v1/users');
  assert.deepEqual(users[0], { id: 1, name: 'Agent One', email: 'a@x.com', active: true });
  assert.equal(users[1].active, false);
});

test('getCurrentUser throws on non-2xx', async () => {
  const { fetchImpl } = fakeFetch({ success: false }, { ok: false, status: 401 });
  const client = createPipedriveClient({ fetchImpl });
  await assert.rejects(() => client.getCurrentUser('https://acme.pipedrive.com', 'bad'), /401/);
});

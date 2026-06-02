'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPersonsClient } = require('../src/pipedrive/persons');

// Fake fetch that returns a different body per call (to simulate variant retries).
function scriptedFetch(responders) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const r = responders[Math.min(i, responders.length - 1)];
    i += 1;
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  };
  return { fetchImpl, calls };
}

function searchBody(items) {
  return { success: true, data: { items } };
}

function personItem(id, name, phones) {
  return { result_score: 1, item: { id, type: 'person', name, phones, organization: null } };
}

test('searchPersonByPhone returns the first matching person', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { body: searchBody([personItem(55, 'Jane Roe', ['9876543210'])]) },
  ]);
  const client = createPersonsClient({ fetchImpl });

  const match = await client.searchPersonByPhone('https://acme.pipedrive.com', 'tok', '+91 98765 43210');

  assert.equal(match.personId, 55);
  assert.equal(match.name, 'Jane Roe');
  // First request hits persons/search with fields=phone and a Bearer token.
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, '/api/v1/persons/search');
  assert.equal(u.searchParams.get('fields'), 'phone');
  assert.ok(u.searchParams.get('term'));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
});

test('searchPersonByPhone tries the next variant when one returns no items', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { body: searchBody([]) }, // first variant: no hit
    { body: searchBody([personItem(7, 'Hit', ['9876543210'])]) }, // second variant: hit
  ]);
  const client = createPersonsClient({ fetchImpl });

  const match = await client.searchPersonByPhone('https://acme.pipedrive.com', 'tok', '9876543210');

  assert.equal(match.personId, 7);
  assert.ok(calls.length >= 2, 'should retry with another variant');
});

test('searchPersonByPhone returns null when no variant matches', async () => {
  const { fetchImpl } = scriptedFetch([{ body: searchBody([]) }]);
  const client = createPersonsClient({ fetchImpl });
  const match = await client.searchPersonByPhone('https://acme.pipedrive.com', 'tok', '9876543210');
  assert.equal(match, null);
});

test('searchPersonByPhone surfaces organization id when present', async () => {
  const item = { result_score: 1, item: { id: 9, name: 'Org Person', phones: ['9876543210'], organization: { id: 300, name: 'Acme' } } };
  const { fetchImpl } = scriptedFetch([{ body: searchBody([item]) }]);
  const client = createPersonsClient({ fetchImpl });
  const match = await client.searchPersonByPhone('https://acme.pipedrive.com', 'tok', '9876543210');
  assert.equal(match.orgId, 300);
});

test('searchPersonByPhone throws on a non-2xx response', async () => {
  const { fetchImpl } = scriptedFetch([{ ok: false, status: 429, body: {} }]);
  const client = createPersonsClient({ fetchImpl });
  await assert.rejects(
    () => client.searchPersonByPhone('https://acme.pipedrive.com', 'tok', '9876543210'),
    /429/
  );
});

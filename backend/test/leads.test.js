'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLeadsClient } = require('../src/pipedrive/leads');
const { createPersonsClient } = require('../src/pipedrive/persons');

function fakeFetch(responseBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: async () => responseBody };
  };
  return { fetchImpl, calls };
}

test('createPerson posts name + phone array and returns the new id', async () => {
  const { fetchImpl, calls } = fakeFetch({ success: true, data: { id: 501 } });
  const persons = createPersonsClient({ fetchImpl });
  const res = await persons.createPerson('https://acme.pipedrive.com', 'tok', { name: '9876543210', phone: '9876543210' });
  assert.equal(res.personId, 501);
  assert.equal(calls[0].url, 'https://acme.pipedrive.com/api/v1/persons');
  assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.name, '9876543210');
  assert.deepEqual(body.phone, [{ value: '9876543210', primary: true, label: 'work' }]);
});

test('createLead posts title + person_id and returns the lead id', async () => {
  const { fetchImpl, calls } = fakeFetch({ success: true, data: { id: 'uuid-lead-1' } });
  const leads = createLeadsClient({ fetchImpl });
  const res = await leads.createLead('https://acme.pipedrive.com', 'tok', { title: 'Inbound call - 9876543210', personId: 501 });
  assert.equal(res.leadId, 'uuid-lead-1');
  assert.equal(calls[0].url, 'https://acme.pipedrive.com/api/v1/leads');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.title, 'Inbound call - 9876543210');
  assert.equal(body.person_id, 501);
});

test('createLead throws on a non-2xx response', async () => {
  const { fetchImpl } = fakeFetch({ success: false }, { ok: false, status: 403 });
  const leads = createLeadsClient({ fetchImpl });
  await assert.rejects(() => leads.createLead('https://acme.pipedrive.com', 'tok', { title: 't', personId: 1 }), /403/);
});

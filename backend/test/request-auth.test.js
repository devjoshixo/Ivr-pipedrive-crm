'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { resolveIdentity } = require('../src/pipedrive/requestAuth');

const JWT_SECRET = 'ra-secret';

function sign(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const apiKeyStore = {
  resolveCompany: async (key) => (key === 'ivrpd_good' ? '9001' : null),
};

test('resolves via API key header', async () => {
  const req = { headers: { 'x-api-key': 'ivrpd_good' } };
  const id = await resolveIdentity(req, { jwtSecret: JWT_SECRET, apiKeyStore });
  assert.deepEqual(id, { companyId: '9001', userId: null, via: 'apikey' });
});

test('rejects an invalid API key', async () => {
  const req = { headers: { 'x-api-key': 'ivrpd_bad' } };
  await assert.rejects(() => resolveIdentity(req, { jwtSecret: JWT_SECRET, apiKeyStore }), /Invalid API key/);
});

test('falls back to the SDK token when no API key is present', async () => {
  const token = sign({ companyId: 9001, userId: 42, exp: 9999999999 });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const id = await resolveIdentity(req, { jwtSecret: JWT_SECRET, apiKeyStore });
  assert.equal(id.companyId, '9001');
  assert.equal(id.userId, '42');
  assert.equal(id.via, 'sdk');
});

test('throws when neither API key nor a valid token is provided', async () => {
  await assert.rejects(() => resolveIdentity({ headers: {} }, { jwtSecret: JWT_SECRET, apiKeyStore }));
});

test('ignores API key path when no apiKeyStore is wired (SDK only)', async () => {
  const token = sign({ companyId: 9001, exp: 9999999999 });
  const req = { headers: { 'x-api-key': 'ivrpd_good', authorization: `Bearer ${token}` } };
  const id = await resolveIdentity(req, { jwtSecret: JWT_SECRET }); // no apiKeyStore
  assert.equal(id.via, 'sdk');
});

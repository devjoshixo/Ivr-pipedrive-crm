'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createTelephonyRouter } = require('../src/routes/telephony');

const JWT_SECRET = 'tele-secret';

function sign(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function harness(overrides = {}) {
  const c2cCalls = [];
  const saved = [];
  const ivrClient = {
    triggerClickToCall: async (token, params) => {
      c2cCalls.push(params);
      return { status: 200, recordid: 'c2c-123' };
    },
    getDids: async () => ({ dids: ['+918044475500'] }),
    getExtensions: async () => ({ exts: [{ ext: '201', name: 'Agent' }] }),
    ...overrides.ivrClient,
  };
  const mappingStore = {
    getForUser: async (companyId, userId) => (userId === '31751199' ? { did: '+918044475500', extension: '201' } : null),
    listMappings: async () => [{ pdUserId: '31751199', did: '+918044475500', extension: '201' }],
    saveMapping: async (companyId, m) => saved.push(m),
    ...overrides.mappingStore,
  };
  const installStore = { getIvrToken: async () => 'ivr-token', ...overrides.installStore };
  const tokenService = { getAccessToken: async () => ({ accessToken: 'AT', apiDomain: 'https://acme.pipedrive.com' }) };
  const pipedriveClient = {
    listUsers: async () => [{ id: 1, name: 'Agent One' }],
    getPerson: async (apiDomain, token, personId) => ({ id: Number(personId), name: 'Jane Roe', phones: ['+919910513597'] }),
  };
  const intents = [];
  const syncStore = {
    saveC2cIntent: async (companyId, intent) => intents.push({ companyId, ...intent }),
    ...overrides.syncStore,
  };
  const config = { pipedrive: { jwtSecret: JWT_SECRET } };

  const app = express();
  app.use(express.json());
  app.use('/api', createTelephonyRouter({ config, installStore, ivrClient, mappingStore, tokenService, pipedriveClient, syncStore }));
  return { app, c2cCalls, saved, intents };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

const tokenWithUser = sign({ companyId: 19733254, userId: 31751199, exp: 9999999999 });

test('click-to-call resolves the user mapping and triggers c2c with last-10 phone', async () => {
  const { app, c2cCalls } = harness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/ivr/click-to-call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenWithUser}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+91 99105-13597' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.recordid, 'c2c-123');
    // DID is normalized to digits (no '+') for c2c_get; phone to last-10.
    assert.deepEqual(c2cCalls[0], { did: '918044475500', extNo: '201', phone: '9910513597' });
  } finally {
    server.close();
  }
});

test('click-to-call saves the dialed-from Person as a c2c intent', async () => {
  const { app, intents } = harness({
    ivrClient: { triggerClickToCall: async () => ({ status: 200, recordid: '750194' }) },
  });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/ivr/click-to-call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenWithUser}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+91 99105-13597', personId: 55 }),
    });
    assert.equal(res.status, 200);
    assert.equal(intents.length, 1, 'one intent recorded');
    assert.equal(intents[0].pbxCallId, 'c2c-750194', 'keyed by c2c-<recordid>');
    assert.equal(intents[0].personId, 55, 'stores the dialed-from person');
  } finally {
    server.close();
  }
});

test('click-to-call returns 400 when the user has no mapping', async () => {
  const { app } = harness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 19733254, userId: 999, exp: 9999999999 }); // unmapped user
    const res = await fetch(`http://localhost:${port}/api/ivr/click-to-call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9910513597' }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('click-to-call rejects an unauthenticated request', async () => {
  const { app } = harness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/ivr/click-to-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9910513597' }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/ivr/dids and /api/ivr/extensions proxy the IVR API', async () => {
  const { app } = harness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const dids = await (await fetch(`http://localhost:${port}/api/ivr/dids`, { headers: { Authorization: `Bearer ${tokenWithUser}` } })).json();
    assert.deepEqual(dids.data.dids, ['+918044475500']);
    const exts = await (await fetch(`http://localhost:${port}/api/ivr/extensions?did=%2B918044475500`, { headers: { Authorization: `Bearer ${tokenWithUser}` } })).json();
    assert.equal(exts.data.exts[0].ext, '201');
  } finally {
    server.close();
  }
});

test('GET /api/mappings and POST /api/mappings work', async () => {
  const { app, saved } = harness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const list = await (await fetch(`http://localhost:${port}/api/mappings`, { headers: { Authorization: `Bearer ${tokenWithUser}` } })).json();
    assert.equal(list.data.mappings[0].extension, '201');

    const res = await fetch(`http://localhost:${port}/api/mappings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenWithUser}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdUserId: '42', did: '+918044475501', extension: '202' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(saved[0], { pdUserId: '42', did: '+918044475501', extension: '202' });
  } finally {
    server.close();
  }
});

test('GET /api/pd/person returns the contact phones for call buttons', async () => {
  const { app } = harness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await (await fetch(`http://localhost:${port}/api/pd/person?personId=55`, { headers: { Authorization: `Bearer ${tokenWithUser}` } })).json();
    assert.equal(res.data.person.name, 'Jane Roe');
    assert.deepEqual(res.data.person.phones, ['+919910513597']);
  } finally {
    server.close();
  }
});

test('GET /api/pd/users lists Pipedrive users', async () => {
  const { app } = harness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await (await fetch(`http://localhost:${port}/api/pd/users`, { headers: { Authorization: `Bearer ${tokenWithUser}` } })).json();
    assert.equal(res.data.users[0].name, 'Agent One');
  } finally {
    server.close();
  }
});

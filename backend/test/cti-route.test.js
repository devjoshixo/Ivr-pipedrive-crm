'use strict';

// Integration test for the screen-pop lookup endpoint: GET /api/cti/lookup.
// Authn is a Pipedrive signed JWT (from GET_SIGNED_TOKEN); the company is taken
// from the verified token, never trusted from a query param.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createCtiRouter } = require('../src/routes/cti');

const JWT_SECRET = 'cti-secret';

function sign(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function buildHarness(personsResult) {
  const tokenService = {
    getAccessToken: async (companyId) => {
      assert.equal(companyId, '9001');
      return { accessToken: 'AT', apiDomain: 'https://acme.pipedrive.com' };
    },
  };
  const personsClient = {
    searchPersonByPhone: async () => personsResult,
  };
  const config = { pipedrive: { jwtSecret: JWT_SECRET } };
  const app = express();
  app.use('/api/cti', createCtiRouter({ config, tokenService, personsClient }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

async function get(port, path, headers) {
  const res = await fetch(`http://localhost:${port}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('lookup returns the matched person with a valid signed token', async () => {
  const app = buildHarness({ personId: 55, name: 'Jane Roe', orgId: null });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const { status, body } = await get(port, '/api/cti/lookup?number=9876543210', {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.match.personId, 55);
  } finally {
    server.close();
  }
});

test('lookup returns a null match when no person is found', async () => {
  const app = buildHarness(null);
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const { status, body } = await get(port, '/api/cti/lookup?number=9876543210', {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 200);
    assert.equal(body.data.match, null);
  } finally {
    server.close();
  }
});

test('lookup rejects a request without a valid token (401)', async () => {
  const app = buildHarness({ personId: 1 });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const { status } = await get(port, '/api/cti/lookup?number=9876543210', {
      Authorization: 'Bearer forged.token.here',
    });
    assert.equal(status, 401);
  } finally {
    server.close();
  }
});

test('lookup requires a number (400)', async () => {
  const app = buildHarness({ personId: 1 });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const { status } = await get(port, '/api/cti/lookup', { Authorization: `Bearer ${token}` });
    assert.equal(status, 400);
  } finally {
    server.close();
  }
});

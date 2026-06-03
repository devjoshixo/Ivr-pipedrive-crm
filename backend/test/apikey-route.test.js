'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createApiKeyRouter } = require('../src/routes/apikey');

const JWT_SECRET = 'ak-secret';

function sign(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function buildApp() {
  const apiKeyStore = {
    regenerate: async (companyId) => ({ key: `ivrpd_${companyId}_raw`, prefix: 'ivrpd_xxxxx' }),
    getMeta: async () => ({ prefix: 'ivrpd_xxxxx', createdAt: '2026-06-03T00:00:00Z', lastUsedAt: null }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/apikey', createApiKeyRouter({ config: { pipedrive: { jwtSecret: JWT_SECRET } }, apiKeyStore }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

const token = sign({ companyId: 9001, exp: 9999999999 });

test('POST /regenerate returns the raw key once (SDK auth)', async () => {
  const server = await listen(buildApp());
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/apikey/regenerate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.key, 'ivrpd_9001_raw');
  } finally {
    server.close();
  }
});

test('GET / returns metadata, never the raw key', async () => {
  const server = await listen(buildApp());
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/apikey`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    assert.equal(body.data.key.prefix, 'ivrpd_xxxxx');
    assert.equal(body.data.key.key, undefined);
  } finally {
    server.close();
  }
});

test('key management rejects an API key (must use the SDK token)', async () => {
  const server = await listen(buildApp());
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/apikey/regenerate`, {
      method: 'POST',
      headers: { 'X-Api-Key': 'ivrpd_whatever' },
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

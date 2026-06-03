'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createApiGuard } = require('../src/middleware/apiGuard');
const { createRateLimiter } = require('../src/middleware/rateLimit');

const JWT_SECRET = 'guard-secret';

function sign(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function appWith(limiter, apiKeyStore) {
  const app = express();
  const router = express.Router();
  router.use(createApiGuard({ jwtSecret: JWT_SECRET, apiKeyStore, limiter }));
  router.get('/ping', (req, res) => res.json({ companyId: req.ivrIdentity.companyId, via: req.ivrIdentity.via }));
  app.use('/api/test', router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

const token = sign({ companyId: 9001, exp: 9999999999 });

test('guard sets identity and passes within the limit', async () => {
  const server = await listen(appWith(createRateLimiter({ max: 5, windowMs: 1000 })));
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/test/ping`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.companyId, '9001');
    assert.equal(body.via, 'sdk');
  } finally {
    server.close();
  }
});

test('guard returns 429 once the per-company limit is exceeded', async () => {
  const server = await listen(appWith(createRateLimiter({ max: 2, windowMs: 60000 })));
  const { port } = server.address();
  try {
    const hit = () => fetch(`http://localhost:${port}/api/test/ping`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await hit()).status, 200);
    assert.equal((await hit()).status, 200);
    const blocked = await hit();
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'), 'sets Retry-After');
  } finally {
    server.close();
  }
});

test('guard authenticates via API key and rate-limits by resolved company', async () => {
  const apiKeyStore = { resolveCompany: async (k) => (k === 'ivrpd_ok' ? '7777' : null) };
  const server = await listen(appWith(createRateLimiter({ max: 1, windowMs: 60000 }), apiKeyStore));
  const { port } = server.address();
  try {
    const r1 = await fetch(`http://localhost:${port}/api/test/ping`, { headers: { 'X-Api-Key': 'ivrpd_ok' } });
    const b1 = await r1.json();
    assert.equal(b1.via, 'apikey');
    assert.equal(b1.companyId, '7777');
    const r2 = await fetch(`http://localhost:${port}/api/test/ping`, { headers: { 'X-Api-Key': 'ivrpd_ok' } });
    assert.equal(r2.status, 429);
  } finally {
    server.close();
  }
});

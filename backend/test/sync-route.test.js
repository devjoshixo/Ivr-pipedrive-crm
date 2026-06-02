'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createSyncRouter } = require('../src/routes/sync');

const JWT_SECRET = 'sync-secret';

function sign(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function buildApp({ summary, state } = {}) {
  const syncRunner = { runForCompany: async () => summary || { created: 2, failed: 0 } };
  const syncStore = { getSyncState: async () => state || null };
  const config = { pipedrive: { jwtSecret: JWT_SECRET } };
  const app = express();
  app.use('/api/sync', createSyncRouter({ config, syncRunner, syncStore }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

test('POST /api/sync/run runs the sync and returns the summary', async () => {
  const app = buildApp({ summary: { created: 5, failed: 1, saturated: ['call_logs'] } });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/sync/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.created, 5);
    assert.deepEqual(body.data.saturated, ['call_logs']);
  } finally {
    server.close();
  }
});

test('GET /api/sync/status returns last sync time and cursors', async () => {
  const app = buildApp({
    state: {
      last_sync_at: '2026-06-02T12:00:00Z',
      last_error: null,
      last_call_log_id: '105',
      last_c2c_log_id: '60',
      last_dialer_log_id: '',
    },
  });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/sync/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.cursors.lastCallLogId, '105');
    assert.equal(body.data.lastError, null);
  } finally {
    server.close();
  }
});

test('sync endpoints reject an unauthenticated request (401)', async () => {
  const app = buildApp();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const run = await fetch(`http://localhost:${port}/api/sync/run`, { method: 'POST' });
    const status = await fetch(`http://localhost:${port}/api/sync/status`);
    assert.equal(run.status, 401);
    assert.equal(status.status, 401);
  } finally {
    server.close();
  }
});

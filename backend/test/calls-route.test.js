'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createCallsRouter } = require('../src/routes/calls');

const JWT_SECRET = 'calls-secret';

function sign(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function buildHarness({ bySip = { pbxCallId: 'rt-1', pdCallLogId: 'log-1', personId: 55 } } = {}) {
  const created = [];
  const marked = [];
  const notes = [];
  const callLogsClient = {
    createCallLog: async (apiDomain, token, payload) => {
      created.push(payload);
      return { id: 'rt-1' };
    },
  };
  const notesClient = {
    addNote: async (apiDomain, token, note) => {
      notes.push(note);
      return { id: 'note-1' };
    },
  };
  const tokenService = { getAccessToken: async () => ({ accessToken: 'AT', apiDomain: 'https://acme.pipedrive.com' }) };
  const syncStore = {
    markSeen: async (companyId, entry) => marked.push(entry),
    getBySip: async () => bySip,
    recentForPerson: async () => [
      { pbxCallId: '101', recordingUrl: 'https://rec/1.wav', source: 'sync', createdAt: '2026-06-02T10:00:00Z' },
    ],
  };
  const config = { pipedrive: { jwtSecret: JWT_SECRET } };
  const app = express();
  app.use(express.json());
  app.use('/api/calls', createCallsRouter({ config, tokenService, callLogsClient, notesClient, syncStore }));
  return { app, created, marked, notes };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

test('POST /api/calls creates a real-time call log and records it by SIP id', async () => {
  const { app, created, marked } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sipCallId: 'sip-xyz',
        number: '9876543210',
        direction: 'inbound',
        durationSec: 33,
        startTime: '2026-06-02T10:00:00Z',
        personId: 55,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.callLogId, 'rt-1');
    assert.equal(created.length, 1);
    assert.equal(created[0].from_phone_number, '9876543210'); // inbound: from = customer
    // Ledger row keyed for reconciliation by the sync.
    assert.equal(marked[0].sipCallId, 'sip-xyz');
    assert.equal(marked[0].source, 'realtime');
    assert.equal(marked[0].pbxCallId, 'rt-sip-xyz');
    assert.equal(marked[0].recordingAttached, false);
  } finally {
    server.close();
  }
});

test('POST /api/calls requires a sipCallId', async () => {
  const { app } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: '9876543210' }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/calls rejects an unauthenticated request', async () => {
  const { app } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sipCallId: 'x' }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/calls/recent returns recordings for a person', async () => {
  const { app } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls/recent?personId=55`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.calls[0].recordingUrl, 'https://rec/1.wav');
  } finally {
    server.close();
  }
});

test('GET /api/calls/recent requires a personId', async () => {
  const { app } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls/recent`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/calls/note back-fills a note onto the linked person', async () => {
  const { app, notes } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls/note`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sipCallId: 'sip-xyz', note: 'Call back Monday' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.applied, true);
    assert.equal(body.data.noteId, 'note-1');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].personId, 55);
    assert.match(notes[0].content, /Call back Monday/);
    assert.match(notes[0].content, /PBX Call Id: rt-1/);
  } finally {
    server.close();
  }
});

test('POST /api/calls/note returns 404 when the call is not logged yet', async () => {
  const { app, notes } = buildHarness({ bySip: null });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls/note`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sipCallId: 'sip-unknown', note: 'hi' }),
    });
    assert.equal(res.status, 404);
    assert.equal(notes.length, 0);
  } finally {
    server.close();
  }
});

test('POST /api/calls/note skips (applied:false) when the call has no linked person', async () => {
  const { app, notes } = buildHarness({ bySip: { pbxCallId: 'rt-2', pdCallLogId: 'log-2', personId: null } });
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls/note`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sipCallId: 'sip-xyz', note: 'orphan note' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.applied, false);
    assert.equal(body.data.reason, 'no_linked_person');
    assert.equal(notes.length, 0);
  } finally {
    server.close();
  }
});

test('POST /api/calls/note requires a note', async () => {
  const { app } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const token = sign({ companyId: 9001, exp: 9999999999 });
    const res = await fetch(`http://localhost:${port}/api/calls/note`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sipCallId: 'sip-xyz' }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

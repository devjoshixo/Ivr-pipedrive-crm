'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { z } = require('zod');

const { validateBody } = require('../src/middleware/validate');

const schema = z.object({
  sipCallId: z.string().min(1, 'is required'),
  durationSec: z.coerce.number().nonnegative().optional(),
});

function app() {
  const a = express();
  a.use(express.json());
  a.post('/x', validateBody(schema), (req, res) => res.json({ body: req.body }));
  return a;
}

function listen(a) {
  return new Promise((resolve) => {
    const s = http.createServer(a);
    s.listen(0, () => resolve(s));
  });
}

async function post(port, body) {
  const res = await fetch(`http://localhost:${port}/x`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('rejects missing required field with a 400 + readable message', async () => {
  const s = await listen(app());
  try {
    const r = await post(s.address().port, { durationSec: 5 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /sipCallId/);
  } finally {
    s.close();
  }
});

test('coerces types and replaces req.body with the parsed value', async () => {
  const s = await listen(app());
  try {
    const r = await post(s.address().port, { sipCallId: 'abc', durationSec: '42' });
    assert.equal(r.status, 200);
    assert.equal(r.body.body.durationSec, 42); // coerced from string to number
    assert.equal(typeof r.body.body.durationSec, 'number');
  } finally {
    s.close();
  }
});

test('rejects a negative duration', async () => {
  const s = await listen(app());
  try {
    const r = await post(s.address().port, { sipCallId: 'abc', durationSec: -3 });
    assert.equal(r.status, 400);
  } finally {
    s.close();
  }
});

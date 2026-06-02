'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { verifySignedToken } = require('../src/pipedrive/jwt');

const SECRET = 'app-client-secret';

function sign(payload, secret = SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc(header);
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

test('verifySignedToken returns the payload for a valid token', () => {
  const token = sign({ userId: 1, companyId: 9001, exp: 9999999999 });
  const claims = verifySignedToken(token, SECRET);
  assert.equal(claims.companyId, 9001);
  assert.equal(claims.userId, 1);
});

test('verifySignedToken rejects a token signed with the wrong secret', () => {
  const token = sign({ companyId: 9001 }, 'wrong-secret');
  assert.throws(() => verifySignedToken(token, SECRET), /signature/i);
});

test('verifySignedToken rejects a tampered payload', () => {
  const token = sign({ companyId: 9001, exp: 9999999999 });
  const parts = token.split('.');
  const forged = Buffer.from(JSON.stringify({ companyId: 1, exp: 9999999999 })).toString('base64url');
  parts[1] = forged;
  assert.throws(() => verifySignedToken(parts.join('.'), SECRET), /signature/i);
});

test('verifySignedToken rejects an expired token', () => {
  const token = sign({ companyId: 9001, exp: 1000 }); // far in the past
  assert.throws(() => verifySignedToken(token, SECRET, { nowSec: 2000 }), /expired/i);
});

test('verifySignedToken rejects a non-HS256 algorithm', () => {
  const token = sign({ companyId: 9001 }, SECRET, { alg: 'none', typ: 'JWT' });
  assert.throws(() => verifySignedToken(token, SECRET), /alg/i);
});

test('verifySignedToken rejects malformed input', () => {
  assert.throws(() => verifySignedToken('not.a.jwt.token', SECRET), /malformed/i);
  assert.throws(() => verifySignedToken('', SECRET), /token/i);
});

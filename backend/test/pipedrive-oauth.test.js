'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAuthorizeUrl, createOAuthClient, OAUTH_BASE } = require('../src/pipedrive/oauth');

function fakeFetch(responseBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: async () => responseBody };
  };
  return { fetchImpl, calls };
}

test('buildAuthorizeUrl includes client_id, redirect_uri and state', () => {
  const url = buildAuthorizeUrl({
    clientId: 'abc123',
    redirectUri: 'https://app.example.com/oauth/callback',
    state: 'xyz',
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, `${OAUTH_BASE}/oauth/authorize`);
  assert.equal(u.searchParams.get('client_id'), 'abc123');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.example.com/oauth/callback');
  assert.equal(u.searchParams.get('state'), 'xyz');
});

test('exchangeCode posts Basic auth + urlencoded authorization_code body', async () => {
  const body = {
    access_token: 'at',
    refresh_token: 'rt',
    token_type: 'bearer',
    scope: 'contacts:read',
    expires_in: 3600,
    api_domain: 'https://acme.pipedrive.com',
  };
  const { fetchImpl, calls } = fakeFetch(body);
  const client = createOAuthClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });

  const result = await client.exchangeCode('the-code', 'https://app.example.com/cb');

  assert.deepEqual(result, body);
  assert.equal(calls[0].url, `${OAUTH_BASE}/oauth/token`);
  assert.equal(calls[0].options.method, 'POST');
  const expectedAuth = 'Basic ' + Buffer.from('id:secret').toString('base64');
  assert.equal(calls[0].options.headers.Authorization, expectedAuth);
  assert.equal(
    calls[0].options.headers['Content-Type'],
    'application/x-www-form-urlencoded'
  );
  const sent = new URLSearchParams(calls[0].options.body);
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code'), 'the-code');
  assert.equal(sent.get('redirect_uri'), 'https://app.example.com/cb');
});

test('refreshToken posts grant_type=refresh_token with the token', async () => {
  const { fetchImpl, calls } = fakeFetch({ access_token: 'new', refresh_token: 'rt2', expires_in: 3600 });
  const client = createOAuthClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });

  await client.refreshToken('old-refresh');

  const sent = new URLSearchParams(calls[0].options.body);
  assert.equal(sent.get('grant_type'), 'refresh_token');
  assert.equal(sent.get('refresh_token'), 'old-refresh');
});

test('token endpoint throws on non-2xx', async () => {
  const { fetchImpl } = fakeFetch({ error: 'invalid_grant' }, { ok: false, status: 400 });
  const client = createOAuthClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  await assert.rejects(() => client.exchangeCode('bad', 'cb'), /400/);
});

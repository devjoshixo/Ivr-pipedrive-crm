'use strict';

// Integration test for the OAuth router: drives /oauth/install and /oauth/callback
// over real HTTP against an Express app, with in-memory fakes for the Pipedrive
// OAuth/API clients and the install store. Proves the full glue: state issue ->
// state verify -> code exchange -> users/me -> token persistence -> redirect.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createOAuthRouter } = require('../src/routes/oauth');

const CONFIG = {
  pipedrive: { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://localhost/oauth/callback' },
  oauthStateSecret: 'integration-secret',
};

function buildHarness() {
  const saved = [];
  const oauthClient = {
    exchangeCode: async (code, redirectUri) => {
      assert.equal(code, 'auth-code-123');
      assert.equal(redirectUri, CONFIG.pipedrive.redirectUri);
      return {
        access_token: 'AT',
        refresh_token: 'RT',
        token_type: 'bearer',
        scope: 'contacts:read activities:full',
        expires_in: 3600,
        api_domain: 'https://acme.pipedrive.com',
      };
    },
  };
  const pipedriveClient = {
    getCurrentUser: async (apiDomain, accessToken) => {
      assert.equal(apiDomain, 'https://acme.pipedrive.com');
      assert.equal(accessToken, 'AT');
      return { id: 7, name: 'Agent', companyId: '9001', companyName: 'Acme', companyDomain: 'acme' };
    },
  };
  const installStore = {
    savePipedriveTokens: async (companyId, data) => saved.push({ companyId, data }),
  };

  const app = express();
  app.use('/oauth', createOAuthRouter({ config: CONFIG, oauthClient, pipedriveClient, installStore }));
  return { app, saved };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

test('GET /oauth/install redirects to the Pipedrive authorize URL with a state', async () => {
  const { app } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/oauth/install`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://oauth.pipedrive.com/oauth/authorize');
    assert.equal(loc.searchParams.get('client_id'), 'cid');
    assert.equal(loc.searchParams.get('redirect_uri'), CONFIG.pipedrive.redirectUri);
    assert.ok(loc.searchParams.get('state'), 'state must be present');
  } finally {
    server.close();
  }
});

test('full callback round-trip persists tokens and redirects to settings', async () => {
  const { app, saved } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    // First hit /install to obtain a valid signed state.
    const installRes = await fetch(`http://localhost:${port}/oauth/install`, { redirect: 'manual' });
    const state = new URL(installRes.headers.get('location')).searchParams.get('state');

    const cbRes = await fetch(
      `http://localhost:${port}/oauth/callback?code=auth-code-123&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' }
    );
    assert.equal(cbRes.status, 302);
    assert.equal(cbRes.headers.get('location'), '/settings.html?company_id=9001');

    assert.equal(saved.length, 1);
    assert.equal(saved[0].companyId, '9001');
    assert.equal(saved[0].data.accessToken, 'AT');
    assert.equal(saved[0].data.refreshToken, 'RT');
    assert.equal(saved[0].data.apiDomain, 'https://acme.pipedrive.com');
    assert.equal(saved[0].data.companyDomain, 'acme');
    assert.ok(saved[0].data.expiresAt instanceof Date);
  } finally {
    server.close();
  }
});

test('callback rejects a missing/invalid state with 400 (CSRF guard)', async () => {
  const { app, saved } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(
      `http://localhost:${port}/oauth/callback?code=auth-code-123&state=forged`,
      { redirect: 'manual' }
    );
    assert.equal(res.status, 400);
    assert.equal(saved.length, 0, 'no tokens should be saved on a bad state');
  } finally {
    server.close();
  }
});

test('callback surfaces a denied authorization', async () => {
  const { app } = buildHarness();
  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/oauth/callback?error=access_denied`, {
      redirect: 'manual',
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

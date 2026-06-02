'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTokenService } = require('../src/pipedrive/tokenService');

// In-memory fake install store.
function fakeStore(install) {
  const state = { install, saved: null };
  return {
    state,
    getInstall: async () => state.install,
    savePipedriveTokens: async (companyId, data) => {
      state.saved = { companyId, data };
      state.install = { ...state.install, ...toRow(data) };
    },
  };
}

function toRow(data) {
  return {
    pd_access_token: data.accessToken,
    pd_refresh_token: data.refreshToken,
    pd_api_domain: data.apiDomain,
    pd_token_expires_at: data.expiresAt,
  };
}

const NOW = 1_700_000_000_000;

test('returns the cached access token when it is still valid', async () => {
  const store = fakeStore({
    company_id: 'c1',
    pd_access_token: 'cached',
    pd_refresh_token: 'rt',
    pd_api_domain: 'https://acme.pipedrive.com',
    pd_token_expires_at: new Date(NOW + 10 * 60 * 1000), // 10 min ahead
  });
  let refreshed = false;
  const oauthClient = { refreshToken: async () => { refreshed = true; } };
  const svc = createTokenService({ installStore: store, oauthClient, now: () => NOW });

  const res = await svc.getAccessToken('c1');

  assert.equal(res.accessToken, 'cached');
  assert.equal(res.apiDomain, 'https://acme.pipedrive.com');
  assert.equal(refreshed, false, 'should not refresh a valid token');
});

test('refreshes and persists when the token is expired', async () => {
  const store = fakeStore({
    company_id: 'c1',
    pd_access_token: 'old',
    pd_refresh_token: 'old-refresh',
    pd_api_domain: 'https://acme.pipedrive.com',
    company_domain: 'acme',
    pd_token_expires_at: new Date(NOW - 1000), // already expired
  });
  const oauthClient = {
    refreshToken: async (rt) => {
      assert.equal(rt, 'old-refresh');
      return {
        access_token: 'fresh',
        refresh_token: 'new-refresh',
        scope: 'contacts:read',
        expires_in: 3600,
        api_domain: 'https://acme.pipedrive.com',
      };
    },
  };
  const svc = createTokenService({ installStore: store, oauthClient, now: () => NOW });

  const res = await svc.getAccessToken('c1');

  assert.equal(res.accessToken, 'fresh');
  assert.equal(store.state.saved.data.accessToken, 'fresh');
  assert.equal(store.state.saved.data.refreshToken, 'new-refresh');
  assert.equal(store.state.saved.data.expiresAt.getTime(), NOW + 3600 * 1000);
});

test('refreshes when the token expires within the safety buffer', async () => {
  const store = fakeStore({
    company_id: 'c1',
    pd_access_token: 'old',
    pd_refresh_token: 'rt',
    pd_token_expires_at: new Date(NOW + 30 * 1000), // 30s — inside the 60s buffer
  });
  let refreshed = false;
  const oauthClient = {
    refreshToken: async () => {
      refreshed = true;
      return { access_token: 'fresh', refresh_token: 'rt2', expires_in: 3600, api_domain: 'https://acme.pipedrive.com' };
    },
  };
  const svc = createTokenService({ installStore: store, oauthClient, now: () => NOW });

  await svc.getAccessToken('c1');
  assert.equal(refreshed, true);
});

test('throws when the company is not connected', async () => {
  const store = fakeStore(null);
  const svc = createTokenService({ installStore: store, oauthClient: {}, now: () => NOW });
  await assert.rejects(() => svc.getAccessToken('missing'), /not connected/i);
});

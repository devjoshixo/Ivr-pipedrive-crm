'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createSettingsRouter } = require('../src/routes/settings');

function buildApp(chromeExtensionUrl) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/settings',
    createSettingsRouter({
      ivrClient: {},
      installStore: {},
      config: { pipedrive: { clientSecret: 's' }, chromeExtensionUrl },
    })
  );
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

test('GET /api/settings/client-config returns the Chrome extension URL (no auth)', async () => {
  const url = 'https://chromewebstore.google.com/detail/x/abc';
  const server = await listen(buildApp(url));
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/settings/client-config`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.chromeExtensionUrl, url);
  } finally {
    server.close();
  }
});

test('GET /api/settings/client-config returns empty string when unconfigured', async () => {
  const server = await listen(buildApp(undefined));
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/settings/client-config`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.chromeExtensionUrl, '');
  } finally {
    server.close();
  }
});

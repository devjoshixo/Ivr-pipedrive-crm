'use strict';

// Express app wiring. The token-validation slice runs with just the IVR client;
// the DB-backed install store is attached only when DATABASE_URL is reachable.

const path = require('node:path');
const express = require('express');
const cors = require('cors');

const { loadConfig } = require('./config');
const { createIvrClient } = require('./ivr/client');
const { createOAuthClient } = require('./pipedrive/oauth');
const { createPipedriveClient } = require('./pipedrive/client');
const { createPersonsClient } = require('./pipedrive/persons');
const { createLeadsClient } = require('./pipedrive/leads');
const { createCallLogsClient } = require('./pipedrive/callLogs');
const { createRecordingsClient } = require('./pipedrive/recordings');
const { createTokenService } = require('./pipedrive/tokenService');
const { createSyncRunner } = require('./sync/runSync');
const { createScheduler } = require('./sync/scheduler');
const { createRetryingFetch } = require('./util/fetchRetry');
const { createHealthRouter } = require('./routes/health');
const { createSettingsRouter } = require('./routes/settings');
const { createOAuthRouter } = require('./routes/oauth');
const { createCtiRouter } = require('./routes/cti');
const { createSyncRouter } = require('./routes/sync');
const { createCallsRouter } = require('./routes/calls');
const { createTelephonyRouter } = require('./routes/telephony');
const { createApiKeyRouter } = require('./routes/apikey');

function buildApp(config) {
  const app = express();
  app.use(express.json());

  // Allow the Pipedrive app iframes (configured origins) to call this backend.
  app.use(
    cors({
      origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
    })
  );

  const ivrClient = createIvrClient({ baseUrl: config.ivrBaseUrl });

  // Persistence is optional for the slice — wired when a pool is available.
  let installStore;
  let syncStore;
  let mappingStore;
  let apiKeyStore;
  try {
    // eslint-disable-next-line global-require
    const { getPool } = require('./db/pool');
    // eslint-disable-next-line global-require
    const { createInstallStore } = require('./db/installStore');
    // eslint-disable-next-line global-require
    const { createSyncStore } = require('./db/syncStore');
    // eslint-disable-next-line global-require
    const { createMappingStore } = require('./db/mappingStore');
    // eslint-disable-next-line global-require
    const { createApiKeyStore } = require('./db/apiKeyStore');
    const pool = getPool(config.databaseUrl);
    installStore = createInstallStore(pool, config.tokenEncKey);
    syncStore = createSyncStore(pool);
    mappingStore = createMappingStore(pool);
    apiKeyStore = createApiKeyStore(pool);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Persistence unavailable (token save + sync disabled):', err.message);
  }

  app.use('/api', createHealthRouter());
  app.use('/api/settings', createSettingsRouter({ ivrClient, installStore, config }));

  // Pipedrive OAuth + CTI + sync — wired only when credentials + persistence exist.
  if (installStore && syncStore && config.pipedrive.clientId && config.pipedrive.clientSecret) {
    const oauthClient = createOAuthClient({
      clientId: config.pipedrive.clientId,
      clientSecret: config.pipedrive.clientSecret,
    });
    // All Pipedrive calls go through a fetch that retries 429/5xx with backoff.
    const pdFetch = createRetryingFetch();
    const pipedriveClient = createPipedriveClient({ fetchImpl: pdFetch });
    const personsClient = createPersonsClient({ fetchImpl: pdFetch });
    const leadsClient = createLeadsClient({ fetchImpl: pdFetch });
    const callLogsClient = createCallLogsClient({ fetchImpl: pdFetch });
    const recordingsClient = createRecordingsClient({ fetchImpl: pdFetch });
    const tokenService = createTokenService({ installStore, oauthClient });
    const syncRunner = createSyncRunner({
      ivrClient,
      callLogsClient,
      personsClient,
      leadsClient,
      recordingsClient,
      tokenService,
      installStore,
      syncStore,
      noMatchPolicy: config.noMatchPolicy,
    });

    app.use('/oauth', createOAuthRouter({ config, oauthClient, pipedriveClient, installStore }));
    app.use('/api/cti', createCtiRouter({ config, tokenService, personsClient, apiKeyStore }));
    app.use('/api/sync', createSyncRouter({ config, syncRunner, syncStore, apiKeyStore }));
    app.use('/api/calls', createCallsRouter({ config, tokenService, callLogsClient, syncStore, apiKeyStore }));
    app.use('/api/apikey', createApiKeyRouter({ config, apiKeyStore }));
    app.use(
      '/api',
      createTelephonyRouter({ config, installStore, ivrClient, mappingStore, tokenService, pipedriveClient, apiKeyStore })
    );

    // Expose the scheduler so start() can begin the polling cadence.
    app.locals.scheduler = createScheduler({
      installStore,
      syncRunner,
      intervalMs: config.syncIntervalMs,
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn('Pipedrive OAuth/CTI/sync not wired (missing client credentials or persistence)');
  }

  // Serve the Pipedrive Custom UI iframes (settings page, softphone host, panel).
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

  return app;
}

function start() {
  const config = loadConfig();
  const app = buildApp(config);
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`IVR Pipedrive backend listening on :${config.port} (${config.nodeEnv})`);
  });
  if (app.locals.scheduler) {
    app.locals.scheduler.start();
    // eslint-disable-next-line no-console
    console.log(`Call-log sync scheduler started (every ${Math.round(config.syncIntervalMs / 1000)}s)`);
  }
}

if (require.main === module) {
  start();
}

module.exports = { buildApp, start };

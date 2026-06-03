'use strict';

// Admin sync endpoints for the setup dashboard (milestone 8):
//   GET  /api/sync/status -> last sync time, last error, cursors
//   POST /api/sync/run    -> run the sync now for the caller's company
//
// Authenticated with the App Extensions SDK signed JWT; company from the claims.

const express = require('express');
const { createApiGuard } = require('../middleware/apiGuard');

const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {{runForCompany: Function}} deps.syncRunner
 * @param {{getSyncState: Function}} deps.syncStore
 * @param {{resolveCompany: Function}} [deps.apiKeyStore]
 * @param {{take: Function}} [deps.limiter]
 */
function createSyncRouter({ config, syncRunner, syncStore, apiKeyStore, limiter }) {
  const router = express.Router();
  const jwtSecret = config.pipedrive.jwtSecret || config.pipedrive.clientSecret;
  router.use(createApiGuard({ jwtSecret, apiKeyStore, limiter }));

  router.get('/status', async (req, res) => {
    const { companyId } = req.ivrIdentity;
    try {
      const [state, stats] = await Promise.all([
        syncStore.getSyncState(companyId),
        syncStore.getStats ? syncStore.getStats(companyId) : null,
      ]);
      return res.json(
        ok({
          lastSyncAt: state ? state.last_sync_at : null,
          lastError: state ? state.last_error : null,
          cursors: state
            ? {
                lastCallLogId: state.last_call_log_id,
                lastC2cLogId: state.last_c2c_log_id,
                lastDialerLogId: state.last_dialer_log_id,
              }
            : null,
          stats,
        })
      );
    } catch {
      return res.status(502).json(fail('Could not read sync status'));
    }
  });

  router.post('/run', async (req, res) => {
    const { companyId } = req.ivrIdentity;
    try {
      const summary = await syncRunner.runForCompany(companyId);
      return res.json(ok(summary));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Manual sync failed:', err.message);
      return res.status(502).json(fail('Sync run failed'));
    }
  });

  return router;
}

module.exports = { createSyncRouter };

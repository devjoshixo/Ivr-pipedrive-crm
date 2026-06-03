'use strict';

// Real-time call logging + recording playback support.
//   POST /api/calls         -> create a call log the moment a call ends (real-time)
//   GET  /api/calls/recent  -> recent calls (with recordings) for a person (panel player)
//
// Both authenticate with the App Extensions SDK signed JWT; company from the claims.
// The real-time row is keyed on the SIP Call-ID so the 15-min sync reconciles against
// it (attaches the recording) instead of creating a duplicate.

const express = require('express');
const { createApiGuard } = require('../middleware/apiGuard');
const { buildCallLogPayload } = require('../sync/callLogPayload');

const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {{getAccessToken: Function}} deps.tokenService
 * @param {{createCallLog: Function}} deps.callLogsClient
 * @param {{markSeen: Function, recentForPerson: Function}} deps.syncStore
 * @param {{resolveCompany: Function}} [deps.apiKeyStore]
 * @param {{take: Function}} [deps.limiter]
 */
function createCallsRouter({ config, tokenService, callLogsClient, syncStore, apiKeyStore, limiter }) {
  const router = express.Router();
  const jwtSecret = config.pipedrive.jwtSecret || config.pipedrive.clientSecret;
  router.use(createApiGuard({ jwtSecret, apiKeyStore, limiter }));

  // Real-time: log a call as soon as it ends (recording is attached later by the sync).
  router.post('/', async (req, res) => {
    const { companyId } = req.ivrIdentity;
    const b = req.body || {};
    const sipCallId = typeof b.sipCallId === 'string' ? b.sipCallId.trim() : '';
    if (!sipCallId) {
      return res.status(400).json(fail('sipCallId is required'));
    }
    try {
      const { accessToken, apiDomain } = await tokenService.getAccessToken(companyId);
      const call = {
        callId: `rt-${sipCallId}`,
        sipCallId,
        inbound: b.direction === 'inbound',
        customerNo: String(b.number || ''),
        agentExt: String(b.agentExt || ''),
        didNo: String(b.didNo || ''),
        durationSeconds: Number(b.durationSec) || 0,
        callTime: b.startTime || '',
        recordingUrl: '', // not known at call-end; the sync backfills it
        note: '',
      };
      const match = b.personId ? { personId: b.personId, orgId: b.orgId } : null;
      const payload = buildCallLogPayload(call, match);
      const result = await callLogsClient.createCallLog(apiDomain, accessToken, payload);
      await syncStore.markSeen(companyId, {
        pbxCallId: call.callId,
        sipCallId,
        pdCallLogId: result && result.id,
        personId: b.personId || null,
        recordingUrl: null,
        recordingAttached: false,
        source: 'realtime',
      });
      return res.json(ok({ callLogId: result && result.id }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Real-time call log failed:', err.message);
      return res.status(502).json(fail('Could not create the call log'));
    }
  });

  // Recordings for a person — powers the panel's audio player.
  router.get('/recent', async (req, res) => {
    const { companyId } = req.ivrIdentity;
    const personId = String(req.query.personId || '').trim();
    if (!personId) {
      return res.status(400).json(fail('personId is required'));
    }
    try {
      const calls = await syncStore.recentForPerson(companyId, personId);
      return res.json(ok({ calls }));
    } catch {
      return res.status(502).json(fail('Could not load recent calls'));
    }
  });

  return router;
}

module.exports = { createCallsRouter };

'use strict';

// Real-time call logging + recording playback support.
//   POST /api/calls         -> create a call log the moment a call ends (real-time)
//   GET  /api/calls/recent  -> recent calls (with recordings) for a person (panel player)
//
// Both authenticate with the App Extensions SDK signed JWT; company from the claims.
// The real-time row is keyed on the SIP Call-ID so the 15-min sync reconciles against
// it (attaches the recording) instead of creating a duplicate.

const express = require('express');
const { z } = require('zod');
const { createApiGuard } = require('../middleware/apiGuard');
const { validateBody } = require('../middleware/validate');
const { buildCallLogPayload } = require('../sync/callLogPayload');
const { buildLateNoteContent } = require('../notes/lateNote');

const callBodySchema = z.object({
  sipCallId: z.string().min(1, 'is required'),
  number: z.string().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  durationSec: z.coerce.number().nonnegative().optional(),
  startTime: z.string().optional(),
  agentExt: z.string().optional(),
  didNo: z.string().optional(),
  personId: z.coerce.number().int().positive().optional(),
  orgId: z.coerce.number().int().positive().optional(),
});

// Late note: an agent typed a note in the softphone after the call was already logged.
const noteBodySchema = z.object({
  sipCallId: z.string().min(1, 'is required'),
  note: z.string().min(1, 'is required').max(5000),
});

const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {{getAccessToken: Function}} deps.tokenService
 * @param {{createCallLog: Function}} deps.callLogsClient
 * @param {{addNote: Function}} [deps.notesClient]
 * @param {{markSeen: Function, recentForPerson: Function, getBySip: Function}} deps.syncStore
 * @param {{resolveCompany: Function}} [deps.apiKeyStore]
 * @param {{take: Function}} [deps.limiter]
 */
function createCallsRouter({ config, tokenService, callLogsClient, notesClient, syncStore, apiKeyStore, limiter }) {
  const router = express.Router();
  const jwtSecret = config.pipedrive.jwtSecret || config.pipedrive.clientSecret;
  router.use(createApiGuard({ jwtSecret, apiKeyStore, limiter }));

  // Real-time: log a call as soon as it ends (recording is attached later by the sync).
  router.post('/', validateBody(callBodySchema), async (req, res) => {
    const { companyId } = req.ivrIdentity;
    const b = req.body;
    const sipCallId = String(b.sipCallId).trim();
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

  // Late note back-fill: a note saved in the softphone after the call was logged.
  // Call logs have no update API, so the note is attached as a Note on the linked
  // person. Reconciled by SIP Call-ID against the real-time / sync ledger row.
  router.post('/note', validateBody(noteBodySchema), async (req, res) => {
    if (!notesClient) {
      return res.status(501).json(fail('Notes are not enabled'));
    }
    const { companyId } = req.ivrIdentity;
    const sipCallId = String(req.body.sipCallId).trim();
    try {
      const row = await syncStore.getBySip(companyId, sipCallId);
      if (!row) {
        // The call may not be logged yet (sync runs every 30s); the agent can retry.
        return res.status(404).json(fail('No logged call found for this call yet'));
      }
      if (!row.personId) {
        // Nothing to attach the note to (call not linked to a person).
        return res.json(ok({ applied: false, reason: 'no_linked_person' }));
      }
      const content = buildLateNoteContent({ note: req.body.note, pbxCallId: row.pbxCallId });
      if (!content) {
        return res.status(400).json(fail('Note is empty'));
      }
      const { accessToken, apiDomain } = await tokenService.getAccessToken(companyId);
      const created = await notesClient.addNote(apiDomain, accessToken, {
        content,
        personId: row.personId,
      });
      return res.json(ok({ applied: true, noteId: created && created.id }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Late note back-fill failed:', err.message);
      return res.status(502).json(fail('Could not save the note'));
    }
  });

  return router;
}

module.exports = { createCallsRouter };

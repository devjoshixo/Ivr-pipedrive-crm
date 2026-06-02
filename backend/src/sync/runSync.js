'use strict';

// Per-company sync orchestrator. Pulls one page (max 20/category) from the IVR API,
// creates a Pipedrive call log for each new record (deduped via synced_calls),
// advances the three cursors, and surfaces a saturation warning when a category is
// full. All dependencies are injected so this is fully unit-testable.

const { parseAll } = require('../ivr/callLog');
const { buildCallLogPayload } = require('./callLogPayload');

const PAGE_SIZE = 20;

function newestRecordId(rawCategory) {
  // The API returns newest-first, so element 0 carries the newest record id.
  return rawCategory && rawCategory[0] ? String(rawCategory[0].recordid || '') : '';
}

/**
 * @param {object} deps
 * @param {{fetchAllCallLogs: Function}} deps.ivrClient
 * @param {{createCallLog: Function}} deps.callLogsClient
 * @param {{searchPersonByPhone: Function}} deps.personsClient
 * @param {{downloadRecording: Function, attachRecording: Function}} [deps.recordingsClient]
 * @param {{getAccessToken: Function}} deps.tokenService
 * @param {{getIvrToken: Function}} deps.installStore
 * @param {object} deps.syncStore
 * @param {number} [deps.now]
 */
function createSyncRunner({
  ivrClient,
  callLogsClient,
  personsClient,
  leadsClient,
  recordingsClient,
  tokenService,
  installStore,
  syncStore,
  noMatchPolicy = 'lead', // 'lead' | 'person' | 'skip'
  now = Date.now(),
}) {
  // Resolve a person/lead link for a call. Pipedrive requires every call log to be
  // linked to something, so on no-match we apply noMatchPolicy: create a Person+Lead
  // (default), create a Person, or skip logging the call.
  async function resolveMatch(call, accessToken, apiDomain) {
    let match = null;
    try {
      match = await personsClient.searchPersonByPhone(apiDomain, accessToken, call.customerNo);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Person search failed for ${call.callId}: ${e.message}`);
    }
    if (match) return match;
    if (noMatchPolicy === 'skip') return null;
    try {
      const person = await personsClient.createPerson(apiDomain, accessToken, {
        name: call.customerNo,
        phone: call.customerNo,
      });
      if (noMatchPolicy === 'lead' && leadsClient) {
        const lead = await leadsClient.createLead(apiDomain, accessToken, {
          title: `${call.inbound ? 'Inbound' : 'Outbound'} call - ${call.customerNo}`,
          personId: person.personId,
        });
        return { personId: person.personId, leadId: lead.leadId };
      }
      return { personId: person.personId };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`No-match create failed for ${call.callId}: ${e.message}`);
      return null;
    }
  }

  // Download the recording and attach it to a call log. Best-effort: any failure
  // leaves the recording unattached (retried next run) — the note keeps the URL.
  async function attachRecordingFor(call, callLogId, accessToken, apiDomain, ivrToken) {
    if (!recordingsClient || !call.recordingUrl || !callLogId) return false;
    const audio = await recordingsClient.downloadRecording(call.recordingUrl, { ivrToken });
    if (!audio) return false;
    return recordingsClient.attachRecording(apiDomain, accessToken, callLogId, {
      data: audio.data,
      filename: `recording-${call.callId}.wav`,
      contentType: audio.contentType,
    });
  }

  async function runForCompany(companyId) {
    const ivrToken = await installStore.getIvrToken(companyId);
    if (!ivrToken) {
      throw new Error(`Company ${companyId} has no IVR token`);
    }

    const cursors = await syncStore.getCursors(companyId);

    let resp;
    try {
      resp = await ivrClient.fetchAllCallLogs(ivrToken, cursors);
    } catch (err) {
      await syncStore.recordError(companyId, `IVR fetch failed: ${err.message}`);
      throw err;
    }

    const calls = parseAll(resp);
    const counts = {
      call_logs: (resp.call_logs || []).length,
      click_to_call: (resp.click_to_call_logs || []).length,
      dialer: (resp.dialer_logs || []).length,
    };

    const seen = await syncStore.filterSeen(companyId, calls.map((c) => c.callId));
    // Real-time logs already created for these SIP ids — reconcile instead of duplicating.
    const realtimeBySip = await syncStore.getRealtimeBySip(
      companyId,
      calls.map((c) => c.sipCallId)
    );
    const { accessToken, apiDomain } = await tokenService.getAccessToken(companyId);

    const matchCache = new Map();
    let created = 0;
    let reconciled = 0;
    let skipped = 0;
    let failed = 0;

    for (const call of calls) {
      if (seen.has(call.callId)) continue;
      try {
        const rt = call.sipCallId ? realtimeBySip.get(call.sipCallId) : null;
        if (rt) {
          // The real-time path already created this call log. Attach the recording
          // (now available) to that same log rather than creating a duplicate.
          if (!rt.recordingAttached && call.recordingUrl) {
            const attached = await attachRecordingFor(call, rt.pdCallLogId, accessToken, apiDomain, ivrToken);
            await syncStore.markRecordingAttached(companyId, call.sipCallId, {
              recordingUrl: call.recordingUrl,
              attached,
            });
            if (attached) reconciled += 1;
          }
          continue;
        }

        let match = null;
        if (call.customerNo) {
          if (matchCache.has(call.customerNo)) {
            match = matchCache.get(call.customerNo);
          } else {
            match = await resolveMatch(call, accessToken, apiDomain);
            matchCache.set(call.customerNo, match);
          }
        }

        // Pipedrive requires every call log to link to a person/org/deal/lead.
        // Without a link (no number, or noMatchPolicy='skip'), skip rather than 400.
        if (!match) {
          skipped += 1;
          continue;
        }

        const payload = buildCallLogPayload(call, match, { now });
        const result = await callLogsClient.createCallLog(apiDomain, accessToken, payload);
        const recordingAttached = await attachRecordingFor(
          call,
          result && result.id,
          accessToken,
          apiDomain,
          ivrToken
        );
        await syncStore.markSeen(companyId, {
          pbxCallId: call.callId,
          sipCallId: call.sipCallId,
          pdCallLogId: result && result.id,
          personId: match && match.personId,
          recordingUrl: call.recordingUrl,
          recordingAttached,
          source: 'sync',
        });
        created += 1;
      } catch (err) {
        failed += 1;
        // eslint-disable-next-line no-console
        console.error(`Failed to sync call ${call.callId}:`, err.message);
      }
    }

    // Advance cursors only for categories that returned records (keep prior otherwise).
    await syncStore.saveCursors(companyId, {
      lastCallLogId: newestRecordId(resp.call_logs) || cursors.lastCallLogId,
      lastC2cLogId: newestRecordId(resp.click_to_call_logs) || cursors.lastC2cLogId,
      lastDialerLogId: newestRecordId(resp.dialer_logs) || cursors.lastDialerLogId,
    });

    const saturated = Object.entries(counts)
      .filter(([, n]) => n >= PAGE_SIZE)
      .map(([k]) => k);

    if (saturated.length > 0 || failed > 0) {
      const parts = [];
      if (saturated.length) {
        parts.push(`WARN: full page (${PAGE_SIZE}) for [${saturated.join(', ')}] — raise sync frequency`);
      }
      if (failed) parts.push(`${failed} record(s) failed to sync`);
      await syncStore.recordError(companyId, parts.join('; '));
    } else {
      await syncStore.recordSuccess(companyId);
    }

    return { created, reconciled, skipped, failed, counts, saturated };
  }

  return { runForCompany };
}

module.exports = { createSyncRunner, PAGE_SIZE };

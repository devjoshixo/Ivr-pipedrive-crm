'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncRunner } = require('../src/sync/runSync');

// In-memory sync store fake.
function fakeSyncStore({ cursors = {}, seen = [], realtime = [] } = {}) {
  const state = {
    cursors: { lastCallLogId: '', lastC2cLogId: '', lastDialerLogId: '', ...cursors },
    seen: new Set(seen),
    realtimeBySip: new Map(realtime.map((r) => [r.sipCallId, r])),
    marked: [],
    attached: [],
    savedCursors: null,
    error: null,
    success: false,
  };
  return {
    state,
    getCursors: async () => state.cursors,
    filterSeen: async (companyId, callIds) => new Set(callIds.filter((id) => state.seen.has(id))),
    getRealtimeBySip: async (companyId, sipIds) => {
      const m = new Map();
      for (const sip of sipIds) {
        if (sip && state.realtimeBySip.has(sip)) m.set(sip, state.realtimeBySip.get(sip));
      }
      return m;
    },
    markRecordingAttached: async (companyId, sipCallId, info) => {
      state.attached.push({ sipCallId, ...info });
    },
    markSeen: async (companyId, entry) => {
      state.marked.push(entry);
      state.seen.add(entry.pbxCallId);
    },
    saveCursors: async (companyId, c) => {
      state.savedCursors = c;
    },
    recordError: async (companyId, message) => {
      state.error = message;
    },
    recordSuccess: async () => {
      state.success = true;
    },
  };
}

function harness({
  resp,
  seen = [],
  realtime = [],
  match = null,
  searchThrows = false,
  noMatchPolicy = 'lead',
  downloadOk = true,
  attachOk = true,
  failCallIds = [],
} = {}) {
  const ivrClient = { fetchAllCallLogs: async () => resp };
  const created = [];
  const failSet = new Set(failCallIds);
  const callLogsClient = {
    createCallLog: async (apiDomain, token, payload) => {
      // Fail by the PBX Call Id embedded in the note (so tests can target a record).
      const m = /PBX Call Id: ([^<]+)/.exec(payload.note || '');
      if (m && failSet.has(m[1].trim())) throw new Error('Pipedrive callLogs create returned 429');
      created.push(payload);
      return { id: `cl-${created.length}` };
    },
  };
  const searchCalls = [];
  const createdPersons = [];
  const createdLeads = [];
  const personsClient = {
    searchPersonByPhone: async (apiDomain, token, number) => {
      searchCalls.push(number);
      if (searchThrows) throw new Error('persons/search returned 403');
      return match;
    },
    createPerson: async (apiDomain, token, { name }) => {
      createdPersons.push(name);
      return { personId: 1000 + createdPersons.length };
    },
  };
  const leadsClient = {
    createLead: async (apiDomain, token, { title, personId }) => {
      createdLeads.push({ title, personId });
      return { leadId: `lead-${createdLeads.length}` };
    },
  };
  const attachedCalls = [];
  const recordingsClient = {
    downloadRecording: async () => (downloadOk ? { data: Buffer.from('wav'), contentType: 'audio/wav' } : null),
    attachRecording: async (apiDomain, token, callLogId) => {
      attachedCalls.push(callLogId);
      return attachOk;
    },
  };
  const tokenService = { getAccessToken: async () => ({ accessToken: 'AT', apiDomain: 'https://acme.pipedrive.com' }) };
  const installStore = { getIvrToken: async () => 'ivr-token' };
  const syncStore = fakeSyncStore({ seen, realtime });
  const runner = createSyncRunner({
    ivrClient,
    callLogsClient,
    personsClient,
    leadsClient,
    recordingsClient,
    tokenService,
    installStore,
    syncStore,
    noMatchPolicy,
    now: Date.parse('2026-06-02T12:00:00Z'),
  });
  return { runner, created, searchCalls, createdPersons, createdLeads, attachedCalls, syncStore };
}

test('creates a call log for each new record and marks them seen', async () => {
  const { runner, created, syncStore } = harness({
    resp: {
      call_logs: [{ recordid: '101', call_type: 'incoming', client_no: '9876500000', call_duration: '30', call_time: '2026-06-02T10:00:00Z' }],
      click_to_call_logs: [{ recordid: '50', client_no: '9876543210', call_duration: '10', call_time: '2026-06-02T09:00:00Z' }],
      dialer_logs: [],
    },
  });
  const summary = await runner.runForCompany('c1');

  assert.equal(created.length, 2);
  assert.equal(summary.created, 2);
  assert.deepEqual(syncStore.state.marked.map((m) => m.pbxCallId).sort(), ['101', 'c2c-50']);
});

test('skips records that were already synced (dedupe)', async () => {
  const { runner, created } = harness({
    resp: {
      call_logs: [{ recordid: '101', call_type: 'incoming', client_no: 'a', call_time: '2026-06-02T10:00:00Z' }],
      click_to_call_logs: [],
      dialer_logs: [],
    },
    seen: ['101'],
  });
  const summary = await runner.runForCompany('c1');
  assert.equal(created.length, 0);
  assert.equal(summary.created, 0);
});

test('advances each cursor to the newest record id (API is newest-first)', async () => {
  const { runner, syncStore } = harness({
    resp: {
      call_logs: [{ recordid: '105', call_type: 'incoming', client_no: 'a', call_time: '2026-06-02T10:00:00Z' }, { recordid: '104' }],
      click_to_call_logs: [{ recordid: '60', client_no: 'b', call_time: '2026-06-02T10:00:00Z' }],
      dialer_logs: [],
    },
  });
  await runner.runForCompany('c1');
  assert.equal(syncStore.state.savedCursors.lastCallLogId, '105');
  assert.equal(syncStore.state.savedCursors.lastC2cLogId, '60');
  assert.equal(syncStore.state.savedCursors.lastDialerLogId, ''); // unchanged when empty
});

test('does NOT advance a category cursor when one of its records fails', async () => {
  const { runner, syncStore } = harness({
    resp: {
      // call_logs: record '5' fails, '4' ok → cursor must stay (re-pull next run)
      call_logs: [
        { recordid: '5', call_type: 'incoming', client_no: 'a', call_time: '2026-06-02T10:00:00Z' },
        { recordid: '4', call_type: 'incoming', client_no: 'b', call_time: '2026-06-02T09:00:00Z' },
      ],
      // click_to_call: all ok → cursor advances normally
      click_to_call_logs: [{ recordid: '60', client_no: 'c', call_time: '2026-06-02T10:00:00Z' }],
      dialer_logs: [],
    },
    match: { personId: 1 }, // matched so no person/lead creation noise
    failCallIds: ['5'],
  });
  const summary = await runner.runForCompany('c1');

  assert.equal(summary.failed, 1);
  assert.equal(syncStore.state.savedCursors.lastCallLogId, '', 'call_logs cursor held due to failure');
  assert.equal(syncStore.state.savedCursors.lastC2cLogId, '60', 'click_to_call cursor advanced (no failures)');
});

test('records a saturation warning when a category returns the 20-record cap', async () => {
  const full = Array.from({ length: 20 }, (_, i) => ({ recordid: String(900 + i), call_type: 'incoming', client_no: 'a', call_time: '2026-06-02T10:00:00Z' }));
  const { runner, syncStore } = harness({
    resp: { call_logs: full, click_to_call_logs: [], dialer_logs: [] },
  });
  const summary = await runner.runForCompany('c1');
  assert.ok(summary.saturated.includes('call_logs'));
  assert.match(syncStore.state.error, /WARN.*full page/);
  assert.equal(syncStore.state.success, false);
});

test('caches person lookups per run (same number searched once)', async () => {
  const { runner, searchCalls } = harness({
    resp: {
      call_logs: [
        { recordid: '1', call_type: 'incoming', client_no: '9876543210', call_time: '2026-06-02T10:00:00Z' },
        { recordid: '2', call_type: 'incoming', client_no: '9876543210', call_time: '2026-06-02T10:01:00Z' },
      ],
      click_to_call_logs: [],
      dialer_logs: [],
    },
    match: { personId: 7 },
  });
  await runner.runForCompany('c1');
  assert.equal(searchCalls.length, 1, 'same customer number should be searched only once');
});

test('attaches the matched person id to the created call log', async () => {
  const { runner, created } = harness({
    resp: {
      call_logs: [{ recordid: '1', call_type: 'incoming', client_no: '9876543210', call_duration: '12', call_time: '2026-06-02T10:00:00Z' }],
      click_to_call_logs: [],
      dialer_logs: [],
    },
    match: { personId: 7, orgId: 300 },
  });
  await runner.runForCompany('c1');
  assert.equal(created[0].person_id, 7);
  assert.equal(created[0].org_id, 300);
});

test('marks success and clears error on a clean (non-saturated) run', async () => {
  const { runner, syncStore } = harness({
    resp: { call_logs: [], click_to_call_logs: [], dialer_logs: [] },
  });
  await runner.runForCompany('c1');
  assert.equal(syncStore.state.success, true);
});

const ONE_CALL = {
  call_logs: [{ recordid: '1', call_type: 'incoming', client_no: '9876543210', call_duration: '20', call_time: '2026-06-02T10:00:00Z' }],
  click_to_call_logs: [],
  dialer_logs: [],
};

test("no-match policy 'lead': creates a Person + Lead and links the call to the lead", async () => {
  const { runner, created, createdPersons, createdLeads } = harness({ resp: ONE_CALL, match: null, noMatchPolicy: 'lead' });
  const summary = await runner.runForCompany('c1');
  assert.equal(summary.created, 1);
  assert.equal(createdPersons.length, 1, 'a Person was created for the unknown caller');
  assert.equal(createdLeads.length, 1, 'a Lead was created');
  assert.equal(created[0].lead_id, 'lead-1', 'call log linked to the lead');
  assert.equal(created[0].person_id, 1001);
});

test("no-match policy 'person': creates a Person only, no Lead", async () => {
  const { runner, created, createdPersons, createdLeads } = harness({ resp: ONE_CALL, match: null, noMatchPolicy: 'person' });
  const summary = await runner.runForCompany('c1');
  assert.equal(summary.created, 1);
  assert.equal(createdPersons.length, 1);
  assert.equal(createdLeads.length, 0, 'no lead created');
  assert.equal(created[0].person_id, 1001);
  assert.equal(created[0].lead_id, undefined);
});

test("no-match policy 'skip': does not create anything and skips the call", async () => {
  const { runner, created, createdPersons } = harness({ resp: ONE_CALL, match: null, noMatchPolicy: 'skip' });
  const summary = await runner.runForCompany('c1');
  assert.equal(summary.created, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(created.length, 0);
  assert.equal(createdPersons.length, 0);
});

test('on search failure, falls through to the no-match policy (logs via a new Lead)', async () => {
  const { runner, created, createdLeads } = harness({ resp: ONE_CALL, searchThrows: true, noMatchPolicy: 'lead' });
  const summary = await runner.runForCompany('c1');
  assert.equal(summary.created, 1, 'call still logged despite search failure');
  assert.equal(createdLeads.length, 1);
  assert.equal(created[0].lead_id, 'lead-1');
});

test('attaches a recording to a sync-created call log when one is present', async () => {
  const { runner, created, attachedCalls } = harness({
    resp: {
      call_logs: [{ recordid: '1', call_type: 'incoming', client_no: 'a', call_duration: '20', call_time: '2026-06-02T10:00:00Z', recording_url: 'https://rec/1.wav' }],
      click_to_call_logs: [],
      dialer_logs: [],
    },
  });
  await runner.runForCompany('c1');
  assert.equal(created.length, 1);
  assert.deepEqual(attachedCalls, ['cl-1'], 'recording attached to the created call log');
});

test('reconciles a real-time call log by SIP id: attaches recording, does NOT duplicate', async () => {
  const { runner, created, attachedCalls, syncStore } = harness({
    resp: {
      call_logs: [{ recordid: '1', call_type: 'incoming', client_no: 'a', sip_call_id: 'sip-xyz', call_duration: '20', call_time: '2026-06-02T10:00:00Z', recording_url: 'https://rec/1.wav' }],
      click_to_call_logs: [],
      dialer_logs: [],
    },
    realtime: [{ sipCallId: 'sip-xyz', pdCallLogId: 'rt-cl-9', recordingAttached: false }],
  });
  const summary = await runner.runForCompany('c1');

  assert.equal(created.length, 0, 'must not create a duplicate call log');
  assert.deepEqual(attachedCalls, ['rt-cl-9'], 'recording attached to the real-time call log');
  assert.equal(summary.reconciled, 1);
  assert.equal(syncStore.state.attached[0].sipCallId, 'sip-xyz');
});

test('does not re-attach when the real-time call log already has its recording', async () => {
  const { runner, created, attachedCalls } = harness({
    resp: {
      call_logs: [{ recordid: '1', call_type: 'incoming', client_no: 'a', sip_call_id: 'sip-xyz', call_duration: '20', call_time: '2026-06-02T10:00:00Z', recording_url: 'https://rec/1.wav' }],
      click_to_call_logs: [],
      dialer_logs: [],
    },
    realtime: [{ sipCallId: 'sip-xyz', pdCallLogId: 'rt-cl-9', recordingAttached: true }],
  });
  await runner.runForCompany('c1');
  assert.equal(created.length, 0);
  assert.equal(attachedCalls.length, 0, 'no attach attempt when already attached');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatUtc, buildCallLogPayload } = require('../src/sync/callLogPayload');

test('formatUtc renders YYYY-MM-DD HH:MM:SS in UTC', () => {
  assert.equal(formatUtc(new Date('2026-06-02T10:05:09Z')), '2026-06-02 10:05:09');
  assert.equal(formatUtc(new Date('2026-01-09T03:04:05Z')), '2026-01-09 03:04:05');
});

const NOW = Date.parse('2026-06-02T12:00:00Z');

test('buildCallLogPayload for an outbound call: to=customer, from=agent, connected', () => {
  const call = {
    callId: '101',
    inbound: false,
    customerNo: '9876543210',
    agentExt: '201',
    didNo: '1800123',
    durationSeconds: 42,
    callTime: '2026-06-02T10:00:00Z',
    recordingUrl: 'https://rec/1.mp3',
    note: 'spoke briefly',
  };
  const p = buildCallLogPayload(call, { personId: 55, orgId: 300 }, { now: NOW });

  assert.equal(p.outcome, 'connected');
  assert.equal(p.to_phone_number, '9876543210');
  assert.equal(p.from_phone_number, '1800123'); // didNo preferred for the agent side
  assert.equal(p.start_time, '2026-06-02 10:00:00');
  assert.equal(p.end_time, '2026-06-02 10:00:42');
  assert.equal(p.duration, '42');
  assert.equal(p.person_id, 55);
  assert.equal(p.org_id, 300);
  assert.match(p.subject, /Outbound call - 9876543210/);
  assert.match(p.note, /rec\/1\.mp3/);
  assert.match(p.note, /101/); // PBX call id embedded for traceability
});

test('buildCallLogPayload for an inbound call: from=customer, to=did/agent', () => {
  const call = {
    callId: '102',
    inbound: true,
    customerNo: '9876500000',
    agentExt: '201',
    didNo: '1800123',
    durationSeconds: 0,
    callTime: '2026-06-02T10:00:00Z',
  };
  const p = buildCallLogPayload(call, null, { now: NOW });

  assert.equal(p.outcome, 'no_answer'); // zero duration
  assert.equal(p.from_phone_number, '9876500000');
  assert.equal(p.to_phone_number, '1800123');
  assert.equal(p.person_id, undefined);
  assert.match(p.subject, /Inbound call - 9876500000/);
});

test('buildCallLogPayload falls back to now when callTime is missing/invalid', () => {
  const call = { callId: '1', inbound: false, customerNo: '5551234', durationSeconds: 5, callTime: '' };
  const p = buildCallLogPayload(call, null, { now: NOW });
  assert.equal(p.start_time, '2026-06-02 12:00:00');
  assert.equal(p.end_time, '2026-06-02 12:00:05');
});

test('buildCallLogPayload guarantees a non-empty to_phone_number for inbound with no agent', () => {
  const call = { callId: '1', inbound: true, customerNo: '5551234', didNo: '', agentExt: '', durationSeconds: 1, callTime: '2026-06-02T10:00:00Z' };
  const p = buildCallLogPayload(call, null, { now: NOW });
  assert.equal(p.to_phone_number, '5551234'); // last-resort fallback
});

test('buildCallLogPayload escapes HTML in the free-text note', () => {
  const call = { callId: '1', inbound: false, customerNo: '5551234', durationSeconds: 1, callTime: '2026-06-02T10:00:00Z', note: '<script>x</script>' };
  const p = buildCallLogPayload(call, null, { now: NOW });
  assert.doesNotMatch(p.note, /<script>/);
  assert.match(p.note, /&lt;script&gt;/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCallLogs, parseClickToCall, parseDialer, parseAll } = require('../src/ivr/callLog');

test('parseCallLogs marks outgoing calls outbound with agent as customer source', () => {
  const [c] = parseCallLogs([
    {
      recordid: '101',
      call_type: 'outgoing',
      attended_by: '9876543210',
      outgoing_ext: '201',
      client_no: '5550000',
      call_duration: '42',
      call_time: '2026-06-02T10:00:00Z',
      recording_url: 'https://rec/1.mp3',
      did_no: '1800123',
      sip_call_id: 'sip-1',
    },
  ]);
  assert.equal(c.callId, '101'); // dedupe key == recordid for call_logs
  assert.equal(c.inbound, false);
  assert.equal(c.customerNo, '9876543210'); // attended_by preferred
  assert.equal(c.durationSeconds, 42);
  assert.equal(c.source, 'call_logs');
});

test('parseCallLogs falls back to outgoing_ext when attended_by is blank', () => {
  const [c] = parseCallLogs([{ recordid: '1', call_type: 'outgoing', attended_by: '', outgoing_ext: '201' }]);
  assert.equal(c.customerNo, '201');
});

test('parseCallLogs marks incoming calls inbound with client_no as customer', () => {
  const [c] = parseCallLogs([
    { recordid: '102', call_type: 'incoming', client_no: '9876500000', call_duration: '0' },
  ]);
  assert.equal(c.inbound, true);
  assert.equal(c.customerNo, '9876500000');
  assert.equal(c.durationSeconds, 0);
});

test('parseClickToCall is always outbound with c2c- prefixed dedupe key', () => {
  const [c] = parseClickToCall([{ recordid: '50', client_no: '9876543210', call_duration: '10' }]);
  assert.equal(c.callId, 'c2c-50');
  assert.equal(c.recordId, '50');
  assert.equal(c.inbound, false);
  assert.equal(c.customerNo, '9876543210');
  assert.equal(c.source, 'click_to_call');
});

test('parseDialer is always outbound with dialer- prefixed dedupe key', () => {
  const [c] = parseDialer([{ recordid: '77', client_no: '9876543210' }]);
  assert.equal(c.callId, 'dialer-77');
  assert.equal(c.source, 'dialer');
  assert.equal(c.inbound, false);
});

test('parseAll concatenates all three categories', () => {
  const all = parseAll({
    call_logs: [{ recordid: '1', call_type: 'incoming', client_no: 'a' }],
    click_to_call_logs: [{ recordid: '2', client_no: 'b' }],
    dialer_logs: [{ recordid: '3', client_no: 'c' }],
  });
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((c) => c.callId), ['1', 'c2c-2', 'dialer-3']);
});

test('parseAll tolerates missing categories', () => {
  assert.deepEqual(parseAll({}), []);
  assert.deepEqual(parseAll({ call_logs: null }), []);
});

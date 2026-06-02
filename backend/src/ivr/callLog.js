'use strict';

// Normalize the IVR /v1/all_call_logs three-category response into a single typed
// call-log shape. Mirrors the Salesforce IvrCallLog.cls direction/dedupe logic.
//
// Dedupe key (callId):
//   - call_logs        -> recordid          (matches the real-time path)
//   - click_to_call    -> "c2c-<recordid>"
//   - dialer           -> "dialer-<recordid>"

const OUTGOING = 'outgoing';

function str(v) {
  return v == null ? '' : String(v);
}

function coalesce(...values) {
  for (const v of values) {
    if (v != null && String(v) !== '') return String(v);
  }
  return '';
}

function toSeconds(v) {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function baseFields(m) {
  return {
    recordId: str(m.recordid),
    durationSeconds: toSeconds(m.call_duration),
    callTime: str(m.call_time),
    recordingUrl: str(m.recording_url),
    didNo: str(m.did_no),
    sipCallId: str(m.sip_call_id),
    note: str(m.note),
    agentExt: coalesce(m.attended_by, m.outgoing_ext),
  };
}

/** call_logs: direction from call_type; customer = attended_by/outgoing_ext (out) or client_no (in). */
function parseCallLogs(raw) {
  return (raw || []).map((m) => {
    const outgoing = str(m.call_type).toLowerCase() === OUTGOING;
    const base = baseFields(m);
    return {
      ...base,
      callId: base.recordId,
      inbound: !outgoing,
      customerNo: outgoing ? coalesce(m.attended_by, m.outgoing_ext) : str(m.client_no),
      source: 'call_logs',
    };
  });
}

/** click_to_call + dialer: always outbound, customer = client_no, prefixed dedupe key. */
function parseOutbound(raw, prefix, source) {
  return (raw || []).map((m) => {
    const base = baseFields(m);
    return {
      ...base,
      callId: `${prefix}${base.recordId}`,
      inbound: false,
      customerNo: str(m.client_no),
      source,
    };
  });
}

const parseClickToCall = (raw) => parseOutbound(raw, 'c2c-', 'click_to_call');
const parseDialer = (raw) => parseOutbound(raw, 'dialer-', 'dialer');

/** Parse and concatenate all three categories from a raw API response. */
function parseAll(resp) {
  const r = resp || {};
  return [
    ...parseCallLogs(r.call_logs),
    ...parseClickToCall(r.click_to_call_logs),
    ...parseDialer(r.dialer_logs),
  ];
}

module.exports = { parseCallLogs, parseClickToCall, parseDialer, parseAll };

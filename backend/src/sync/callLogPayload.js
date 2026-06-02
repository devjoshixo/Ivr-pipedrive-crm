'use strict';

// Build a Pipedrive POST /v1/callLogs payload from a normalized IvrCallLog plus an
// optional person match. Pipedrive requires outcome/to_phone_number/start_time/end_time;
// datetimes are "YYYY-MM-DD HH:MM:SS" in UTC and duration is a seconds string.

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Format a Date as Pipedrive's UTC "YYYY-MM-DD HH:MM:SS". */
function formatUtc(date) {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function buildNote(call) {
  const parts = [];
  if (call.note) parts.push(escapeHtml(call.note));
  if (call.recordingUrl) {
    const url = escapeHtml(call.recordingUrl);
    parts.push(`<a href="${url}">Call recording</a>`);
  }
  // Embed the PBX call id so a human can trace the record back to the PBX.
  parts.push(`PBX Call Id: ${escapeHtml(call.callId)}`);
  return parts.join('<br>');
}

/**
 * @param {object} call - normalized IvrCallLog
 * @param {{personId?, orgId?}|null} match
 * @param {{now?: number}} [opts]
 * @returns {object} Pipedrive callLogs payload
 */
function buildCallLogPayload(call, match, { now = Date.now() } = {}) {
  const startMs = call.callTime ? Date.parse(call.callTime) : NaN;
  const start = new Date(Number.isFinite(startMs) ? startMs : now);
  const end = new Date(start.getTime() + (call.durationSeconds || 0) * 1000);

  const customer = call.customerNo || '';
  const agentSide = call.didNo || call.agentExt || '';

  const payload = {
    outcome: call.durationSeconds > 0 ? 'connected' : 'no_answer',
    from_phone_number: call.inbound ? customer : agentSide,
    // to_phone_number is required and must be non-empty.
    to_phone_number: call.inbound ? agentSide || customer : customer,
    start_time: formatUtc(start),
    end_time: formatUtc(end),
    duration: String(call.durationSeconds || 0),
    subject: `${call.inbound ? 'Inbound' : 'Outbound'} call - ${customer}`,
    note: buildNote(call),
  };
  if (match && match.personId) payload.person_id = match.personId;
  if (match && match.orgId) payload.org_id = match.orgId;
  if (match && match.leadId) payload.lead_id = match.leadId;
  return payload;
}

module.exports = { formatUtc, buildCallLogPayload };

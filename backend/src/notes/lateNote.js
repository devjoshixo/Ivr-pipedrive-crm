'use strict';

// Build the HTML content for a "late note" — an agent's note typed in the softphone
// AFTER the call was already logged. Pipedrive call logs have no update endpoint, so
// the note is back-filled as a Pipedrive Note on the linked person; a reference line
// ties it back to the PBX call so a human can match it to the call activity.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * @param {object} input
 * @param {string} input.note - the agent's free-text note
 * @param {string} [input.pbxCallId] - the ledger pbx_call_id (for traceability)
 * @returns {string} HTML note content, or '' when the note is blank
 */
function buildLateNoteContent({ note, pbxCallId } = {}) {
  const body = String(note == null ? '' : note).trim();
  if (!body) return '';
  const parts = [escapeHtml(body)];
  if (pbxCallId) parts.push(`Call note added after logging · PBX Call Id: ${escapeHtml(pbxCallId)}`);
  return parts.join('<br>');
}

module.exports = { buildLateNoteContent };

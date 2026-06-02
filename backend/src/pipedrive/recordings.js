'use strict';

// Recording handling: download the .wav from the IVR recording host and attach it to
// a Pipedrive call log via the multipart `POST /callLogs/{id}/recordings` endpoint.
//
// Both operations are best-effort (return null/false instead of throwing) so a
// recording problem never blocks call-log creation — the recording URL also lives in
// the call-log note as a fallback, and an unattached recording is retried next sync.

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createRecordingsClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  /**
   * Download a recording. Tries unauthenticated first, then with the IVR bearer token.
   * @param {string} url
   * @param {{ivrToken?: string}} [opts]
   * @returns {Promise<{data: ArrayBuffer, contentType: string}|null>}
   */
  async function downloadRecording(url, { ivrToken } = {}) {
    async function attempt(headers) {
      const res = await fetchImpl(url, headers ? { headers } : undefined);
      if (!res.ok) return { status: res.status };
      const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || 'audio/wav';
      return { data: await res.arrayBuffer(), contentType };
    }
    try {
      let r = await attempt(null);
      if (r.data) return { data: r.data, contentType: r.contentType };
      if ((r.status === 401 || r.status === 403) && ivrToken) {
        r = await attempt({ Authorization: `Bearer ${ivrToken}` });
        if (r.data) return { data: r.data, contentType: r.contentType };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Attach an audio file to a call log. Returns true on success.
   * @param {string} apiDomain
   * @param {string} accessToken
   * @param {string} callLogId
   * @param {{data: ArrayBuffer|Buffer, filename: string, contentType: string}} file
   * @returns {Promise<boolean>}
   */
  async function attachRecording(apiDomain, accessToken, callLogId, file) {
    try {
      const form = new FormData();
      const blob = new Blob([file.data], { type: file.contentType || 'audio/wav' });
      form.append('file', blob, file.filename || 'recording.wav');
      const res = await fetchImpl(`${apiDomain}/api/v1/callLogs/${callLogId}/recordings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }, // fetch sets multipart boundary
        body: form,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  return { downloadRecording, attachRecording };
}

module.exports = { createRecordingsClient };

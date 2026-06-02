'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRecordingsClient } = require('../src/pipedrive/recordings');

function recorder(responses) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const r = typeof responses === 'function' ? responses(url, options) : responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r;
  };
  return { fetchImpl, calls };
}

test('downloadRecording fetches the URL and returns bytes + content type', async () => {
  const audio = Buffer.from('RIFFfakewav');
  const { fetchImpl, calls } = recorder([
    { ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => audio },
  ]);
  const client = createRecordingsClient({ fetchImpl });

  const result = await client.downloadRecording('https://calls2.ivrsolutions.in/x.wav');
  assert.equal(calls[0].url, 'https://calls2.ivrsolutions.in/x.wav');
  assert.equal(result.contentType, 'audio/wav');
  assert.ok(Buffer.from(result.data).equals(audio));
});

test('downloadRecording retries with the IVR bearer token on 401/403', async () => {
  const audio = Buffer.from('wav');
  const { fetchImpl, calls } = recorder([
    { ok: false, status: 401 },
    { ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => audio },
  ]);
  const client = createRecordingsClient({ fetchImpl });

  const result = await client.downloadRecording('https://calls2.ivrsolutions.in/x.wav', { ivrToken: 'tok' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer tok');
  assert.ok(Buffer.from(result.data).equals(audio));
});

test('downloadRecording returns null when the file cannot be fetched', async () => {
  const { fetchImpl } = recorder([{ ok: false, status: 404 }]);
  const client = createRecordingsClient({ fetchImpl });
  const result = await client.downloadRecording('https://calls2.ivrsolutions.in/missing.wav');
  assert.equal(result, null);
});

test('attachRecording POSTs multipart form-data with the file field and Bearer auth', async () => {
  const { fetchImpl, calls } = recorder([{ ok: true, status: 200, json: async () => ({ success: true }) }]);
  const client = createRecordingsClient({ fetchImpl });

  const okResult = await client.attachRecording('https://acme.pipedrive.com', 'tok', 'cl-1', {
    data: Buffer.from('wav'),
    filename: 'rec.wav',
    contentType: 'audio/wav',
  });

  assert.equal(okResult, true);
  assert.equal(calls[0].url, 'https://acme.pipedrive.com/api/v1/callLogs/cl-1/recordings');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  // Body is a FormData carrying a `file` part. Content-Type is set by fetch (boundary).
  assert.ok(calls[0].options.body instanceof FormData);
  assert.ok(calls[0].options.body.has('file'));
});

test('attachRecording returns false on a non-2xx response (non-throwing)', async () => {
  const { fetchImpl } = recorder([{ ok: false, status: 415, json: async () => ({}) }]);
  const client = createRecordingsClient({ fetchImpl });
  const result = await client.attachRecording('https://acme.pipedrive.com', 'tok', 'cl-1', {
    data: Buffer.from('x'),
    filename: 'r.wav',
    contentType: 'audio/wav',
  });
  assert.equal(result, false);
});

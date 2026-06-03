// IVRSolutions recording-player panel (Pipedrive Custom Panel on a Person page).
// Lists recent calls with recordings for the current person and plays them inline.
import SDK, {
  Command,
} from 'https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/+esm';
import { personIdFromSearch } from './panel-context.mjs';

// The CDN's +esm build nests the constructor under default.default; tolerate both shapes.
const AppExtensionsSDK = typeof SDK === 'function' ? SDK : SDK.default;

const BACKEND_BASE = window.IVR_BACKEND_BASE || '';
let sdk = null;
let signedToken = null;

async function getToken() {
  if (signedToken) return signedToken;
  try {
    const r = await sdk.execute(Command.GET_SIGNED_TOKEN);
    signedToken = r && r.token;
  } catch {
    signedToken = null;
  }
  return signedToken;
}

function render(calls) {
  const root = document.getElementById('calls');
  root.innerHTML = '';
  if (!calls || calls.length === 0) {
    root.innerHTML = '<p class="muted">No recorded calls for this contact yet.</p>';
    return;
  }
  for (const c of calls) {
    const item = document.createElement('div');
    item.className = 'item';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const when = c.createdAt ? new Date(c.createdAt).toLocaleString() : '';
    meta.textContent = `${c.source === 'realtime' ? 'Live' : 'Synced'} · ${when}`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = c.recordingUrl;
    item.appendChild(meta);
    item.appendChild(audio);
    root.appendChild(item);
  }
}

async function authedFetch(path, options = {}) {
  const token = await getToken();
  return fetch(`${BACKEND_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token || ''}` },
  });
}

// c2c click-to-call: rings the agent's softphone + cell, then bridges the customer.
async function callViaC2C(phone, statusEl) {
  statusEl.textContent = 'Calling…';
  try {
    const res = await authedFetch('/api/ivr/click-to-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const body = await res.json();
    statusEl.textContent = res.ok ? 'Ringing your phone…' : (body && body.error) || 'Call failed';
  } catch {
    statusEl.textContent = 'Backend unreachable';
  }
}

// Softphone WebRTC dial: surface the floating window so the agent can dial there.
// (The native phone-field click also imports the number into the softphone.)
async function dialInSoftphone() {
  try {
    if (sdk && sdk.execute) {
      // TODO(verify in-product): pass the number as floating-window context if supported.
      await sdk.execute('show_floating_window');
    }
  } catch {
    /* non-fatal */
  }
}

function renderCallButtons(person) {
  const root = document.getElementById('callbar');
  root.innerHTML = '';
  const phones = (person && person.phones) || [];
  if (phones.length === 0) {
    root.innerHTML = '<p class="muted">No phone number on this contact.</p>';
    return;
  }
  phones.forEach((phone) => {
    const row = document.createElement('div');
    row.className = 'callrow';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = phone;
    const call = document.createElement('button');
    call.textContent = 'Call';
    call.title = 'Rings your softphone + cell, then the customer';
    const soft = document.createElement('button');
    soft.className = 'secondary';
    soft.textContent = 'Softphone';
    soft.title = 'Dial in the browser softphone';
    const status = document.createElement('span');
    status.className = 'callstatus';
    call.addEventListener('click', () => callViaC2C(phone, status));
    soft.addEventListener('click', dialInSoftphone);
    row.appendChild(num);
    row.appendChild(call);
    row.appendChild(soft);
    row.appendChild(status);
    root.appendChild(row);
  });
}

async function load() {
  // TODO(verify in-product): confirm how the panel receives the current record id.
  const personId = personIdFromSearch(window.location.search);
  if (!personId) {
    document.getElementById('calls').innerHTML = '<p class="muted">Open a contact to see calls.</p>';
    return;
  }
  // Call buttons (contact phones).
  try {
    const pRes = await authedFetch(`/api/pd/person?personId=${encodeURIComponent(personId)}`);
    if (pRes.ok) {
      const pBody = await pRes.json();
      renderCallButtons(pBody.data ? pBody.data.person : null);
    }
  } catch {
    /* leave the call bar empty */
  }
  // Recordings.
  try {
    const res = await authedFetch(`/api/calls/recent?personId=${encodeURIComponent(personId)}`);
    if (!res.ok) {
      document.getElementById('calls').innerHTML = '<p class="muted">Could not load recordings.</p>';
      return;
    }
    const body = await res.json();
    render(body.data ? body.data.calls : []);
  } catch {
    document.getElementById('calls').innerHTML = '<p class="muted">Could not reach the backend.</p>';
  }
}

async function init() {
  try {
    sdk = await new AppExtensionsSDK().initialize();
  } catch {
    /* outside Pipedrive (local preview) — still attempt to load via URL params */
  }
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

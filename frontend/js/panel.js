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

async function load() {
  // TODO(verify in-product): confirm how the panel receives the current record id.
  const personId = personIdFromSearch(window.location.search);
  if (!personId) {
    document.getElementById('calls').innerHTML = '<p class="muted">Open a contact to see call recordings.</p>';
    return;
  }
  try {
    const token = await getToken();
    const res = await fetch(`${BACKEND_BASE}/api/calls/recent?personId=${encodeURIComponent(personId)}`, {
      headers: { Authorization: `Bearer ${token || ''}` },
    });
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

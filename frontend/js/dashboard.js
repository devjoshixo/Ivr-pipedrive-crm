// IVRSolutions setup dashboard (Pipedrive Settings UI extension).
// Shows sync status and lets the admin run the sync on demand. Authenticates calls
// to the backend with the App Extensions SDK signed token.
import SDK, {
  Command,
} from 'https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/+esm';

// The CDN's +esm build nests the constructor under default.default; tolerate both shapes.
const AppExtensionsSDK = typeof SDK === 'function' ? SDK : SDK.default;

const BACKEND_BASE = window.IVR_BACKEND_BASE || '';
let sdk = null;
let signedToken = null;

const $ = (id) => document.getElementById(id);

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

async function api(path, options = {}) {
  const token = await getToken();
  return fetch(`${BACKEND_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token || ''}` },
  });
}

function fmtTime(iso) {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function renderStatus(data) {
  $('lastSync').textContent = fmtTime(data.lastSyncAt);
  const errEl = $('lastError');
  if (data.lastError) {
    errEl.textContent = data.lastError;
    errEl.className = 'value err';
  } else {
    errEl.textContent = 'none';
    errEl.className = 'value ok';
  }
  const c = data.cursors || {};
  $('cursors').textContent = `calls:${c.lastCallLogId || '-'}  c2c:${c.lastC2cLogId || '-'}  dialer:${c.lastDialerLogId || '-'}`;

  const s = data.stats || {};
  $('statCalls').textContent = s.total != null ? s.total : '–';
  $('statPeople').textContent = s.people != null ? s.people : '–';
  $('statRecordings').textContent = s.withRecording != null ? s.withRecording : '–';
}

async function loadStatus() {
  try {
    const res = await api('/api/sync/status');
    if (!res.ok) {
      $('lastError').textContent = res.status === 401 ? 'Not authorized' : 'Could not load status';
      return;
    }
    const body = await res.json();
    renderStatus(body.data);
  } catch {
    $('lastError').textContent = 'Could not reach the backend';
  }
}

async function runSync() {
  const btn = $('runBtn');
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    const res = await api('/api/sync/run', { method: 'POST' });
    const body = await res.json();
    if (res.ok) {
      const d = body.data || {};
      $('runResult').textContent = `Created ${d.created || 0}, reconciled ${d.reconciled || 0}, failed ${d.failed || 0}` +
        (d.saturated && d.saturated.length ? ` — saturated: ${d.saturated.join(', ')}` : '');
    } else {
      $('runResult').textContent = (body && body.error) || 'Sync failed';
    }
  } catch {
    $('runResult').textContent = 'Could not reach the backend';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run sync now';
    loadStatus();
  }
}

async function init() {
  try {
    sdk = await new AppExtensionsSDK().initialize();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('SDK init failed:', err && err.message);
  }
  $('runBtn').addEventListener('click', runSync);
  loadStatus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

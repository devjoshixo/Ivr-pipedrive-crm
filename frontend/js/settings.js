// IVRSolutions settings page (Pipedrive App settings — Custom UI).
// Custom UI extensions are SDK-mandatory: Pipedrive needs the SDK handshake to
// display/size this iframe, so we initialise it on load. The token is validated and
// saved through our backend; save is authenticated with the SDK signed token.
import SDK, {
  Command,
} from 'https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/+esm';

// The CDN's +esm build nests the constructor under default.default; tolerate both shapes.
const AppExtensionsSDK = typeof SDK === 'function' ? SDK : SDK.default;

const BACKEND_BASE = window.IVR_BACKEND_BASE || '';
// Standalone fallback (post-OAuth redirect lands here with ?company_id=).
const params = new URLSearchParams(window.location.search);
const companyIdParam = params.get('company_id') || params.get('companyId') || '';

let sdk = null;
let signedToken = null;
let lastValidatedToken = null;

const tokenEl = document.getElementById('token');
const validateBtn = document.getElementById('validateBtn');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

function setStatus(kind, text, busy) {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = '';
  if (busy) {
    const s = document.createElement('span');
    s.className = 'spinner';
    statusEl.appendChild(s);
  } else if (kind) {
    const d = document.createElement('span');
    d.className = 'dot ' + kind;
    statusEl.appendChild(d);
  }
  const t = document.createElement('span');
  t.textContent = text;
  statusEl.appendChild(t);
}

async function getSignedToken() {
  if (signedToken) return signedToken;
  if (sdk) {
    try {
      const r = await sdk.execute(Command.GET_SIGNED_TOKEN);
      signedToken = r && r.token;
    } catch {
      signedToken = null;
    }
  }
  return signedToken;
}

async function postJson(path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(BACKEND_BASE + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

async function validate() {
  const token = tokenEl.value.trim();
  if (!token) {
    setStatus('err', 'Enter a token first.');
    return;
  }
  validateBtn.disabled = true;
  saveBtn.disabled = true;
  setStatus('', 'Validating…', true);
  try {
    const r = await postJson('/api/settings/validate-token', { token });
    if (r.ok && r.data.success && r.data.data.valid) {
      lastValidatedToken = token;
      setStatus('ok', 'Token is valid.');
      saveBtn.disabled = false;
    } else {
      lastValidatedToken = null;
      setStatus('err', (r.data && r.data.error) || 'Token was rejected.');
    }
  } catch {
    setStatus('err', 'Could not reach the integration backend.');
  } finally {
    validateBtn.disabled = false;
  }
}

async function save() {
  const token = tokenEl.value.trim();
  if (token !== lastValidatedToken) {
    setStatus('err', 'Validate the current token before saving.');
    return;
  }
  saveBtn.disabled = true;
  setStatus('', 'Saving…', true);
  try {
    const auth = await getSignedToken();
    const body = { token };
    if (companyIdParam) body.companyId = companyIdParam; // standalone fallback
    if (!auth && !companyIdParam) {
      setStatus('err', 'Company context missing — open this page inside Pipedrive.');
      saveBtn.disabled = false;
      return;
    }
    const r = await postJson('/api/settings/save-token', body, auth);
    if (r.ok && r.data.success) {
      setStatus('ok', 'Connected. Your account is ready.');
    } else {
      setStatus('err', (r.data && r.data.error) || 'Could not save the token.');
      saveBtn.disabled = false;
    }
  } catch {
    setStatus('err', 'Could not reach the integration backend.');
    saveBtn.disabled = false;
  }
}

async function init() {
  try {
    sdk = await new AppExtensionsSDK().initialize();
    getSignedToken();
  } catch {
    // Running standalone (outside Pipedrive) — the form still works via the
    // company_id URL param from the post-OAuth redirect.
  }
  validateBtn.addEventListener('click', validate);
  saveBtn.addEventListener('click', save);
  tokenEl.addEventListener('input', () => {
    saveBtn.disabled = true;
    if (statusEl.textContent) setStatus('', '');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

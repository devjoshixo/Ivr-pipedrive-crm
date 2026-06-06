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

// ---------- DID / extension -> Pipedrive user mapping (c2c routing) ----------
async function authedFetch(path, options = {}) {
  const auth = await getSignedToken();
  const res = await fetch(BACKEND_BASE + path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${auth || ''}` },
  });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

let mapDids = [];
const mapByUser = {};

function mkOption(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

async function loadExtensions(did, extSel, selectedExt) {
  extSel.innerHTML = '';
  extSel.appendChild(mkOption('', '—'));
  if (!did) return;
  const r = await authedFetch(`/api/ivr/extensions?did=${encodeURIComponent(did)}`);
  const exts = (r.ok && r.data && r.data.data && r.data.data.exts) || [];
  exts.forEach((e) =>
    extSel.appendChild(mkOption(e.ext, `${e.ext}${e.name ? ' — ' + e.name : ''}`, String(e.ext) === String(selectedExt)))
  );
}

function buildMapRow(user) {
  const existing = mapByUser[String(user.id)] || {};
  const tr = document.createElement('tr');
  const nameTd = document.createElement('td');
  nameTd.textContent = user.name + (user.active === false ? ' (inactive)' : '');
  tr.appendChild(nameTd);

  const didSel = document.createElement('select');
  didSel.appendChild(mkOption('', '—'));
  mapDids.forEach((d) => didSel.appendChild(mkOption(d, d, d === existing.did)));
  const didTd = document.createElement('td');
  didTd.appendChild(didSel);
  tr.appendChild(didTd);

  const extSel = document.createElement('select');
  const extTd = document.createElement('td');
  extTd.appendChild(extSel);
  tr.appendChild(extTd);

  const saveMapBtn = document.createElement('button');
  saveMapBtn.textContent = 'Save';
  saveMapBtn.className = 'secondary';
  const note = document.createElement('span');
  note.className = 'maps-note';
  const actTd = document.createElement('td');
  actTd.appendChild(saveMapBtn);
  actTd.appendChild(note);
  tr.appendChild(actTd);

  loadExtensions(existing.did, extSel, existing.extension);
  didSel.addEventListener('change', () => loadExtensions(didSel.value, extSel, ''));
  saveMapBtn.addEventListener('click', async () => {
    saveMapBtn.disabled = true;
    note.textContent = ' Saving…';
    const r = await authedFetch('/api/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdUserId: String(user.id), did: didSel.value, extension: extSel.value }),
    });
    note.textContent = r.ok ? ' Saved ✓' : ' Failed';
    saveMapBtn.disabled = false;
  });
  return tr;
}

async function loadMappings() {
  const body = document.getElementById('mapRows');
  if (!body) return;
  try {
    const [u, d, m] = await Promise.all([
      authedFetch('/api/pd/users'),
      authedFetch('/api/ivr/dids'),
      authedFetch('/api/mappings'),
    ]);
    const users = (u.data && u.data.data && u.data.data.users) || [];
    mapDids = (d.data && d.data.data && d.data.data.dids) || [];
    ((m.data && m.data.data && m.data.data.mappings) || []).forEach((x) => {
      mapByUser[String(x.pdUserId)] = x;
    });
    body.innerHTML = '';
    if (!users.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">No users found.</td></tr>';
      return;
    }
    users.forEach((usr) => body.appendChild(buildMapRow(usr)));
  } catch {
    body.innerHTML = '<tr><td colspan="4" class="muted">Could not load — open inside Pipedrive.</td></tr>';
  }
}

// ---------- Sync status + stats + manual run ----------
function fmtTime(iso) {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function loadStatus() {
  const el = (id) => document.getElementById(id);
  try {
    const r = await authedFetch('/api/sync/status');
    if (!r.ok || !r.data || !r.data.data) return;
    const d = r.data.data;
    el('lastSync').textContent = fmtTime(d.lastSyncAt);
    const err = el('lastError');
    if (d.lastError) {
      err.textContent = d.lastError;
      err.className = 'value err';
    } else {
      err.textContent = 'none';
      err.className = 'value';
    }
    const s = d.stats || {};
    el('statCalls').textContent = s.total != null ? s.total : '–';
    el('statPeople').textContent = s.people != null ? s.people : '–';
    el('statRecordings').textContent = s.withRecording != null ? s.withRecording : '–';
  } catch {
    /* leave placeholders */
  }
}

async function runSync() {
  const btn = document.getElementById('runBtn');
  const out = document.getElementById('runResult');
  btn.disabled = true;
  out.textContent = ' Running…';
  try {
    const r = await authedFetch('/api/sync/run', { method: 'POST' });
    const d = r.data && r.data.data;
    out.textContent = r.ok && d ? ` Done — ${d.created} new, ${d.reconciled} updated.` : ' Sync failed';
  } catch {
    out.textContent = ' Backend unreachable';
  } finally {
    btn.disabled = false;
    loadStatus();
  }
}

// ---------- Companion Chrome extension install card ----------
async function loadExtensionCard() {
  const card = document.getElementById('extCard');
  const link = document.getElementById('extLink');
  try {
    const res = await fetch(BACKEND_BASE + '/api/settings/client-config');
    const body = await res.json();
    const url = body && body.data && body.data.chromeExtensionUrl;
    if (url && link) {
      link.href = url;
    } else if (card) {
      card.style.display = 'none'; // no URL configured — hide the prompt
    }
  } catch {
    if (card) card.style.display = 'none';
  }
}

// ---------- Server-to-server API key ----------
async function loadApiKey() {
  try {
    const r = await authedFetch('/api/apikey');
    const meta = r.ok && r.data && r.data.data && r.data.data.key;
    document.getElementById('apiKeyBox').textContent = meta
      ? `${meta.prefix}…  (created ${fmtTime(meta.createdAt)})`
      : 'No key yet — click Generate.';
  } catch {
    document.getElementById('apiKeyBox').textContent = 'Could not load key.';
  }
}

async function regenerateKey() {
  const btn = document.getElementById('genKeyBtn');
  const out = document.getElementById('keyResult');
  btn.disabled = true;
  out.textContent = ' Generating…';
  try {
    const r = await authedFetch('/api/apikey/regenerate', { method: 'POST' });
    if (r.ok && r.data && r.data.data) {
      document.getElementById('apiKeyBox').textContent = r.data.data.key; // shown once
      out.textContent = ' Copy it now — not shown again.';
    } else {
      out.textContent = ' Failed';
    }
  } catch {
    out.textContent = ' Backend unreachable';
  } finally {
    btn.disabled = false;
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
  const runBtn = document.getElementById('runBtn');
  const genBtn = document.getElementById('genKeyBtn');
  if (runBtn) runBtn.addEventListener('click', runSync);
  if (genBtn) genBtn.addEventListener('click', regenerateKey);
  loadExtensionCard();

  // The mapping / sync-status / API-key sections need the SDK signed token, which only
  // exists when the page runs INSIDE Pipedrive. On the standalone post-OAuth landing
  // (no SDK), hide them and point the admin into Pipedrive — avoids confusing 401s.
  const embedded = !!sdk;
  const manage = document.getElementById('pdManage');
  const note = document.getElementById('pdOnlyNote');
  if (embedded) {
    if (note) note.hidden = true;
    if (manage) manage.style.display = '';
    loadMappings();
    loadStatus();
    loadApiKey();
  } else {
    if (manage) manage.style.display = 'none';
    if (note) note.hidden = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

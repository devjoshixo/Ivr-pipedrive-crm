// IVRSolutions DID/extension -> Pipedrive user mapping page (Custom UI).
// For each Pipedrive user, pick the DID and extension they use. The mapping routes
// click-to-call (which extension to ring) and attributes call ownership.
import SDK, {
  Command,
} from 'https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/+esm';

const AppExtensionsSDK = typeof SDK === 'function' ? SDK : SDK.default;
const BACKEND_BASE = window.IVR_BACKEND_BASE || '';

let sdk = null;
let signedToken = null;
let dids = [];
const mappingByUser = {};

async function getToken() {
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

async function api(path, options = {}) {
  const token = await getToken();
  return fetch(`${BACKEND_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token || ''}` },
  });
}

function option(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

async function loadExtensions(did, extSelect, selectedExt) {
  extSelect.innerHTML = '';
  extSelect.appendChild(option('', '—'));
  if (!did) return;
  try {
    const res = await api(`/api/ivr/extensions?did=${encodeURIComponent(did)}`);
    const body = await res.json();
    const exts = (body.data && body.data.exts) || [];
    exts.forEach((e) => {
      extSelect.appendChild(option(e.ext, `${e.ext}${e.name ? ' — ' + e.name : ''}`, String(e.ext) === String(selectedExt)));
    });
  } catch {
    /* leave just the placeholder */
  }
}

function buildRow(user) {
  const existing = mappingByUser[String(user.id)] || {};
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  nameTd.textContent = user.name + (user.active === false ? ' (inactive)' : '');
  tr.appendChild(nameTd);

  const didTd = document.createElement('td');
  const didSel = document.createElement('select');
  didSel.appendChild(option('', '—'));
  dids.forEach((d) => didSel.appendChild(option(d, d, d === existing.did)));
  didTd.appendChild(didSel);
  tr.appendChild(didTd);

  const extTd = document.createElement('td');
  const extSel = document.createElement('select');
  extTd.appendChild(extSel);
  tr.appendChild(extTd);

  const actTd = document.createElement('td');
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  const note = document.createElement('span');
  note.className = 'note';
  actTd.appendChild(saveBtn);
  actTd.appendChild(note);
  tr.appendChild(actTd);

  // Populate extensions for the current DID, then on every DID change.
  loadExtensions(existing.did, extSel, existing.extension);
  didSel.addEventListener('change', () => loadExtensions(didSel.value, extSel, ''));

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    note.textContent = 'Saving…';
    try {
      const res = await api('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdUserId: String(user.id), did: didSel.value, extension: extSel.value }),
      });
      note.textContent = res.ok ? 'Saved ✓' : 'Failed';
      note.className = 'note ' + (res.ok ? 'ok' : 'err');
    } catch {
      note.textContent = 'Backend unreachable';
      note.className = 'note err';
    } finally {
      saveBtn.disabled = false;
    }
  });

  return tr;
}

async function load() {
  const body = document.getElementById('rows');
  try {
    const [uRes, dRes, mRes] = await Promise.all([
      api('/api/pd/users'),
      api('/api/ivr/dids'),
      api('/api/mappings'),
    ]);
    const users = ((await uRes.json()).data || {}).users || [];
    dids = (((await dRes.json()).data || {}).dids) || [];
    const mappings = (((await mRes.json()).data || {}).mappings) || [];
    mappings.forEach((m) => { mappingByUser[String(m.pdUserId)] = m; });

    body.innerHTML = '';
    if (users.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="muted">No users found.</td></tr>';
      return;
    }
    users.forEach((u) => body.appendChild(buildRow(u)));
  } catch {
    body.innerHTML = '<tr><td colspan="4" class="err">Could not load. Open this page inside Pipedrive.</td></tr>';
  }
}

async function init() {
  try {
    sdk = await new AppExtensionsSDK().initialize();
  } catch {
    /* standalone preview */
  }
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

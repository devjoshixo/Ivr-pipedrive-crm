// IVRSolutions floating-window host (Pipedrive Custom Floating Window).
//
// Runs inside the floating-window iframe. Responsibilities:
//   1. Initialise the Pipedrive App Extensions SDK.
//   2. Bridge postMessage <-> the embedded Browser-Phone softphone (cdn.founderscart.com),
//      which carries pipedrive-cti-adapter.js.
//   3. Click-to-dial: on Event.VISIBILITY (fired when a user clicks a phone field),
//      pull the number from the event context and tell the softphone to dial.
//   4. Inbound: when the softphone reports an incoming call, show the window + focus
//      mode and screen-pop the matching person (via the backend lookup endpoint).
//   5. No-match inbound: prompt the softphone's "save contact" overlay.
//
// The SDK is loaded from the documented CDN ESM build. For a production bundle,
// swap to `import AppExtensionsSDK, { Command, Event } from '@pipedrive/app-extensions-sdk'`.
import SDK, {
  Command,
  Event,
} from 'https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/+esm';
import { extractNumberFromContext } from './cti-context.mjs';

// The CDN's +esm build nests the constructor under default.default; tolerate both shapes.
const AppExtensionsSDK = typeof SDK === 'function' ? SDK : SDK.default;

const SOFTPHONE_ORIGIN = 'https://cdn.founderscart.com';
const BACKEND_BASE = window.IVR_BACKEND_BASE || '';
const frame = document.getElementById('softphone');

let sdk = null;
let signedToken = null;
// Remember the most recent screen-popped person so a real-time call log can link to it.
let lastPersonId = null;

function sendToSoftphone(message) {
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(message, SOFTPHONE_ORIGIN);
  }
}

async function refreshSignedToken() {
  try {
    const res = await sdk.execute(Command.GET_SIGNED_TOKEN);
    signedToken = res && res.token;
  } catch {
    signedToken = null;
  }
  return signedToken;
}

async function lookupPerson(number) {
  if (!signedToken) await refreshSignedToken();
  try {
    const res = await fetch(`${BACKEND_BASE}/api/cti/lookup?number=${encodeURIComponent(number)}`, {
      headers: { Authorization: `Bearer ${signedToken || ''}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.data ? body.data.match : null;
  } catch {
    return null;
  }
}

async function logCallEnded(m) {
  if (!signedToken) await refreshSignedToken();
  try {
    await fetch(`${BACKEND_BASE}/api/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signedToken || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sipCallId: m.sipCallId,
        number: m.number,
        direction: m.direction,
        durationSec: m.durationSec,
        startTime: m.startTime,
        personId: lastPersonId,
      }),
    });
  } catch {
    /* non-fatal: the 15-min sync will still capture this call */
  }
}

async function screenPop(number) {
  const match = await lookupPerson(number);
  lastPersonId = match && match.personId ? match.personId : null;
  if (match && match.personId) {
    try {
      // TODO(verify in-product): confirm the REDIRECT_TO payload that opens a single
      // Person record (view + id). Falls back silently if the shape differs.
      await sdk.execute(Command.REDIRECT_TO, { view: 'CONTACTS', id: match.personId });
    } catch {
      /* non-fatal */
    }
  } else {
    // No match: let the softphone offer to save the caller as a new person.
    sendToSoftphone({ action: 'IVR_PROMPT_SAVE_CONTACT', number, timeoutMs: 5000 });
  }
}

async function setFocus(enabled) {
  try {
    // TODO(verify in-product): confirm the SET_FOCUS_MODE payload shape.
    await sdk.execute(Command.SET_FOCUS_MODE, { enabled });
  } catch {
    /* non-fatal */
  }
}

// Softphone -> host bridge.
window.addEventListener('message', (event) => {
  if (event.origin !== SOFTPHONE_ORIGIN) return;
  const m = event.data || {};
  switch (m.type) {
    case 'IVR_READY':
      break;
    case 'IVR_INCOMING_CALL':
      if (sdk) {
        // Surface the window (if hidden/minimized) and show a banner.
        sdk.execute(Command.SHOW_FLOATING_WINDOW).catch(() => {});
        setFocus(true);
        sdk
          .execute(Command.SHOW_SNACKBAR, {
            message: `Incoming call${m.number ? ' from ' + m.number : ''}`,
          })
          .catch(() => {});
      }
      if (m.number) screenPop(m.number);
      break;
    case 'IVR_CALL_CONNECTED':
      // Call answered — focus mode keeps the window open during the call.
      break;
    case 'IVR_CALL_ENDED':
      if (sdk) setFocus(false);
      logCallEnded(m);
      break;
    case 'IVR_SAVE_CONTACT':
      if (sdk) {
        // TODO(milestone 5): prefill the phone number in the PERSON create modal.
        sdk.execute(Command.OPEN_MODAL, { type: 'PERSON' }).catch(() => {});
      }
      break;
    default:
      break;
  }
});

// The softphone needs the full floating-window height or its content is clipped.
// Window limits are 70–700 high, 200–800 wide; default to the tallest preset.
const WINDOW_WIDTH = 400;
const WINDOW_SIZE = { height: 700, width: WINDOW_WIDTH };

async function resizeTo(height) {
  try {
    await sdk.execute(Command.RESIZE, { height, width: WINDOW_WIDTH });
  } catch {
    /* non-fatal */
  }
  document.querySelectorAll('#sizebar button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.h) === height);
  });
}

function setupSizeBar() {
  document.querySelectorAll('#sizebar button').forEach((b) => {
    b.addEventListener('click', () => resizeTo(Number(b.dataset.h)));
  });
}

async function init() {
  try {
    sdk = await new AppExtensionsSDK().initialize({ size: WINDOW_SIZE });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('App Extensions SDK init failed:', err && err.message);
    return;
  }
  refreshSignedToken();
  setupSizeBar();
  resizeTo(WINDOW_SIZE.height); // enforce + mark the default preset active

  // Click-to-dial: VISIBILITY fires when the window is shown from a phone-field click.
  sdk.listen(Event.VISIBILITY, (payload) => {
    const data = payload && payload.data ? payload.data : payload;
    if (data && data.is_visible) {
      const number = extractNumberFromContext(data.context);
      if (number) sendToSoftphone({ action: 'IVR_DIAL', number });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

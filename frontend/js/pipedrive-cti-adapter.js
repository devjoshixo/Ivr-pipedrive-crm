/* IVRSolutions Pipedrive CTI adapter.
 *
 * Ported from salesforce-cti-adapter.js. This script is injected INTO the hosted
 * Browser-Phone softphone (cdn.founderscart.com/.../softphone/). It wraps the
 * Browser-Phone globals (ReceiveCall, DialByLine, onInviteAccepted) and bridges
 * them to the parent window (the Pipedrive Custom Floating Window host) via
 * postMessage.
 *
 * Softphone -> host events:
 *   { type: 'IVR_READY' }
 *   { type: 'IVR_INCOMING_CALL', number }
 *   { type: 'IVR_CALL_CONNECTED', number, direction }   direction: 'inbound' | 'outbound'
 *   { type: 'IVR_SAVE_CONTACT', number }
 *
 * Host -> softphone commands:
 *   { action: 'IVR_DIAL', number }
 *   { action: 'IVR_PROMPT_SAVE_CONTACT', number, timeoutMs }
 *
 * Note: like the Salesforce adapter, this deliberately does NOT emit IVR_CALL_ENDED.
 * Call logging is owned by the backend (real-time CallLogs create + 15-min sync),
 * keyed on the PBX recordid, so the softphone never creates duplicate records.
 */
(function () {
  'use strict';

  // In production set this to the Pipedrive app host origin. '*' for dev only.
  var ALLOWED_PARENT = '*';

  var pendingDirection = 'inbound';
  var promptTimer = null;
  // Tracks the active call so IVR_CALL_ENDED can carry duration + SIP id.
  var activeCall = null;

  function toHost(message) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, ALLOWED_PARENT);
    }
  }

  function sipIdFromSession(session) {
    try {
      // SIP.js exposes the Call-ID on the session; fall back to a few known shapes.
      return (
        (session && session.callId) ||
        (session && session.request && session.request.callId) ||
        (session && session.dialog && session.dialog.callId) ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  function numberFromSession(session) {
    try {
      return session && session.remoteIdentity && session.remoteIdentity.uri
        ? session.remoteIdentity.uri.user
        : null;
    } catch (e) {
      return null;
    }
  }

  // --- Host -> softphone ---------------------------------------------------
  window.addEventListener('message', function (e) {
    if (ALLOWED_PARENT !== '*' && e.origin !== ALLOWED_PARENT) return;
    var m = e.data || {};

    if (m.action === 'IVR_DIAL' && m.number) {
      pendingDirection = 'outbound';
      if (typeof DialByLine === 'function') {
        DialByLine('audio', null, String(m.number));
      }
    } else if (m.action === 'IVR_PROMPT_SAVE_CONTACT' && m.number) {
      showSavePrompt(String(m.number), m.timeoutMs || 5000);
    }
  });

  // --- Softphone -> host (wrap Browser-Phone globals) ----------------------
  if (typeof ReceiveCall === 'function') {
    var _receiveCall = ReceiveCall;
    ReceiveCall = function (session) {
      pendingDirection = 'inbound';
      var num = numberFromSession(session);
      if (num) toHost({ type: 'IVR_INCOMING_CALL', number: num });
      return _receiveCall.apply(this, arguments);
    };
  }

  if (typeof onInviteAccepted === 'function') {
    var _onInviteAccepted = onInviteAccepted;
    onInviteAccepted = function (lineObj) {
      try {
        var session = lineObj ? lineObj.SipSession : null;
        var number = numberFromSession(session);
        activeCall = {
          number: number,
          direction: pendingDirection,
          sipCallId: sipIdFromSession(session),
          startedAt: Date.now(),
        };
        toHost({ type: 'IVR_CALL_CONNECTED', number: number, direction: pendingDirection });
      } catch (e) {
        /* non-fatal */
      }
      return _onInviteAccepted.apply(this, arguments);
    };
  }

  // Browser-Phone calls this provisioning hook when a session ends. Emit the
  // call-end event so the host can log it in real time. The host/sync reconcile on
  // sipCallId so this never duplicates the 15-min sync's record.
  window.web_hook_on_terminate = function (session) {
    try {
      if (!activeCall) return;
      var durationSec = Math.max(0, Math.round((Date.now() - activeCall.startedAt) / 1000));
      toHost({
        type: 'IVR_CALL_ENDED',
        number: activeCall.number,
        direction: activeCall.direction,
        sipCallId: activeCall.sipCallId || sipIdFromSession(session),
        durationSec: durationSec,
        startTime: new Date(activeCall.startedAt).toISOString(),
      });
    } catch (e) {
      /* non-fatal */
    } finally {
      activeCall = null;
    }
  };

  // --- 5-second "Save contact?" prompt for unknown inbound callers ---------
  function removeSavePrompt() {
    if (promptTimer) {
      window.clearTimeout(promptTimer);
      promptTimer = null;
    }
    var existing = document.getElementById('ivrSavePrompt');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function showSavePrompt(number, timeoutMs) {
    removeSavePrompt();
    var box = document.createElement('div');
    box.id = 'ivrSavePrompt';
    box.style.cssText =
      'position:fixed;bottom:14px;left:14px;z-index:2147483647;background:#0b5cab;' +
      'color:#fff;padding:10px 14px;border-radius:8px;font:13px system-ui;cursor:pointer;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.25)';
    box.textContent = 'Unknown caller ' + number + ' — click to save as a person';
    box.addEventListener('click', function () {
      toHost({ type: 'IVR_SAVE_CONTACT', number: number });
      removeSavePrompt();
    });
    document.body.appendChild(box);
    promptTimer = window.setTimeout(removeSavePrompt, timeoutMs);
  }

  // Announce readiness once the DOM is up.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    toHost({ type: 'IVR_READY' });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      toHost({ type: 'IVR_READY' });
    });
  }
})();

// Pure helpers for the floating-window host, kept free of any SDK/DOM dependency so
// they can be unit-tested in Node. Imported by softphone-host.js.

/**
 * Pipedrive delivers click-to-dial details on the VISIBILITY event's `context`.
 * The exact field name isn't documented, so probe the likely shapes defensively.
 * @param {object} context
 * @returns {string|null}
 */
export function extractNumberFromContext(context) {
  if (!context) return null;
  return (
    context.number ||
    context.phone ||
    context.phoneNumber ||
    (context.call && context.call.number) ||
    (context.data && (context.data.number || context.data.phone)) ||
    null
  );
}

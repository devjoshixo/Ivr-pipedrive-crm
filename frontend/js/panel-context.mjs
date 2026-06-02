// Pure helpers for the recording-player panel — no SDK/DOM deps so they're testable.

/**
 * Resolve the current person id for a Custom Panel. Pipedrive passes the record on
 * the iframe URL; the exact param name isn't firmly documented, so probe the likely
 * ones (verify in-product). Returns a string id or null.
 * @param {string} search - window.location.search
 */
export function personIdFromSearch(search) {
  const p = new URLSearchParams(search || '');
  // Panels on a Person page; deal/org pages would resolve a different entity.
  const candidates = ['personId', 'selectedIds', 'id', 'resourceId'];
  for (const key of candidates) {
    const v = p.get(key);
    if (v) return String(v).split(',')[0];
  }
  return null;
}

'use strict';

// Phone-number normalization + variant generation for matching call-log numbers
// against Pipedrive persons. Mirrors the Zoho/Salesforce logic (strip non-digits,
// take last 10, build India-formatted variants). Used by screen-pop lookup and the
// 15-min sync's person matching.

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function lastTen(value) {
  const d = digitsOnly(value);
  return d.length > 10 ? d.slice(-10) : d;
}

/**
 * Build the set of search terms to try against Pipedrive, ordered most-specific first.
 * @param {string} raw
 * @returns {string[]}
 */
function variants(raw) {
  const set = new Set();
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  set.add(trimmed);

  const d = digitsOnly(raw);
  if (d) {
    set.add(d);
    set.add(`+${d}`);
    const ten = lastTen(d);
    if (ten) {
      set.add(ten);
      set.add(`91${ten}`);
      set.add(`+91${ten}`);
      set.add(`0${ten}`);
    }
  }
  return [...set];
}

module.exports = { digitsOnly, lastTen, variants };

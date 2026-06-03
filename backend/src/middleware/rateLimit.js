'use strict';

// Simple per-company fixed-window rate limiter (in-memory). Single-instance; a
// multi-instance deployment would back this with Redis. Keyed by company so one
// customer can't exhaust another's budget.

/**
 * @param {object} [opts]
 * @param {number} [opts.max] - requests allowed per window
 * @param {number} [opts.windowMs]
 * @param {() => number} [opts.now]
 */
function createRateLimiter({ max = 120, windowMs = 60000, now = Date.now } = {}) {
  const buckets = new Map(); // key -> { count, resetAt }

  function take(key) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t >= b.resetAt) {
      b = { count: 0, resetAt: t + windowMs };
      buckets.set(key, b);
    }
    if (b.count >= max) {
      return { allowed: false, retryAfterMs: b.resetAt - t, remaining: 0 };
    }
    b.count += 1;
    return { allowed: true, retryAfterMs: 0, remaining: max - b.count };
  }

  return { take };
}

module.exports = { createRateLimiter };

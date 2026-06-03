'use strict';

// A fetch wrapper that transparently retries on Pipedrive rate limits (429) and
// transient server errors (5xx), with exponential backoff that honors Retry-After.
// Pipedrive's token-based daily budget + burst caps make 429s expected during large
// syncs (we observed them), so all Pipedrive clients use this around their fetch.

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.maxRetries]
 * @param {number} [opts.baseDelayMs]
 * @param {(ms:number)=>Promise<void>} [opts.sleep] - injectable for tests
 * @returns {typeof fetch}
 */
function createRetryingFetch({
  fetchImpl = globalThis.fetch,
  maxRetries = 4,
  baseDelayMs = 500,
  sleep = defaultSleep,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  return async function retryingFetch(url, options) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetchImpl(url, options);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        return res;
      }
      const retryAfter = res.headers && res.headers.get && res.headers.get('retry-after');
      const delay = retryAfter
        ? Number(retryAfter) * 1000
        : baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
      attempt += 1;
    }
  };
}

module.exports = { createRetryingFetch };

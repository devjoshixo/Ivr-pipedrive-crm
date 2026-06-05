'use strict';

// 15-minute scheduler that runs the sync for every connected company. The IVR API
// caps results at 20/category with no paging, so frequency is the throttle — keep
// the interval at or below 15 minutes for busy accounts (saturation warnings tell
// the admin when to go faster).

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // prune at most once a day

/**
 * @param {object} deps
 * @param {{listConnectedCompanyIds: Function}} deps.installStore
 * @param {{runForCompany: Function}} deps.syncRunner
 * @param {{pruneSyncedCalls: Function}} [deps.syncStore] - enables ledger pruning
 * @param {number} [deps.intervalMs]
 * @param {number} [deps.retentionDays] - prune ledger rows older than this; <=0 disables
 * @param {number} [deps.pruneIntervalMs] - min gap between prunes (default 24h)
 * @param {Console} [deps.logger]
 * @param {() => number} [deps.now]
 */
function createScheduler({
  installStore,
  syncRunner,
  syncStore,
  intervalMs = DEFAULT_INTERVAL_MS,
  retentionDays = 0,
  pruneIntervalMs = DEFAULT_PRUNE_INTERVAL_MS,
  logger = console,
  now = () => Date.now(),
}) {
  let handle = null;
  let inFlight = false; // prevents overlapping ticks at tight intervals (e.g. 30s)
  let lastPruneAt = 0;

  // Throttled ledger cleanup. Runs at most once per pruneIntervalMs, independent of
  // the sync cadence. No-op unless a syncStore + positive retention are configured.
  async function maybePrune() {
    if (!syncStore || typeof syncStore.pruneSyncedCalls !== 'function' || retentionDays <= 0) return;
    const t = now();
    if (t - lastPruneAt < pruneIntervalMs) return;
    lastPruneAt = t;
    try {
      const deleted = await syncStore.pruneSyncedCalls(retentionDays, { now: t });
      if (deleted > 0) {
        logger.log(`Pruned ${deleted} synced_calls row(s) older than ${retentionDays}d`);
      }
    } catch (err) {
      logger.error('Ledger prune failed:', err.message);
    }
  }

  async function tick() {
    if (inFlight) {
      return { ran: 0, total: 0, skipped: true };
    }
    inFlight = true;
    try {
      let ids = [];
      try {
        ids = await installStore.listConnectedCompanyIds();
      } catch (err) {
        logger.error('Scheduler could not list companies:', err.message);
        return { ran: 0, total: 0 };
      }
      let ran = 0;
      for (const id of ids) {
        try {
          await syncRunner.runForCompany(id);
          ran += 1;
        } catch (err) {
          logger.error(`Scheduled sync failed for ${id}:`, err.message);
        }
      }
      await maybePrune();
      return { ran, total: ids.length };
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (!handle) {
      handle = setInterval(() => {
        tick().catch((err) => logger.error('Scheduler tick error:', err.message));
      }, intervalMs);
      if (handle.unref) handle.unref(); // don't keep the process alive just for the timer
    }
  }

  function stop() {
    if (handle) {
      clearInterval(handle);
      handle = null;
    }
  }

  return { start, stop, tick };
}

module.exports = { createScheduler, DEFAULT_INTERVAL_MS };

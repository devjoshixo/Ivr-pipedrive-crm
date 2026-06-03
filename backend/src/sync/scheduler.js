'use strict';

// 15-minute scheduler that runs the sync for every connected company. The IVR API
// caps results at 20/category with no paging, so frequency is the throttle — keep
// the interval at or below 15 minutes for busy accounts (saturation warnings tell
// the admin when to go faster).

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/**
 * @param {object} deps
 * @param {{listConnectedCompanyIds: Function}} deps.installStore
 * @param {{runForCompany: Function}} deps.syncRunner
 * @param {number} [deps.intervalMs]
 * @param {Console} [deps.logger]
 */
function createScheduler({ installStore, syncRunner, intervalMs = DEFAULT_INTERVAL_MS, logger = console }) {
  let handle = null;
  let inFlight = false; // prevents overlapping ticks at tight intervals (e.g. 30s)

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

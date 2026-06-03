'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduler } = require('../src/sync/scheduler');

const silentLogger = { error: () => {}, log: () => {} };

test('tick runs the sync for every connected company', async () => {
  const ran = [];
  const scheduler = createScheduler({
    installStore: { listConnectedCompanyIds: async () => ['c1', 'c2', 'c3'] },
    syncRunner: { runForCompany: async (id) => ran.push(id) },
    logger: silentLogger,
  });
  const result = await scheduler.tick();
  assert.deepEqual(ran, ['c1', 'c2', 'c3']);
  assert.deepEqual(result, { ran: 3, total: 3 });
});

test('tick continues past a company whose sync throws', async () => {
  const ran = [];
  const scheduler = createScheduler({
    installStore: { listConnectedCompanyIds: async () => ['c1', 'bad', 'c3'] },
    syncRunner: {
      runForCompany: async (id) => {
        if (id === 'bad') throw new Error('boom');
        ran.push(id);
      },
    },
    logger: silentLogger,
  });
  const result = await scheduler.tick();
  assert.deepEqual(ran, ['c1', 'c3']);
  assert.equal(result.ran, 2);
  assert.equal(result.total, 3);
});

test('a tick does not overlap a still-running tick (skips instead)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const scheduler = createScheduler({
    installStore: { listConnectedCompanyIds: async () => ['c1'] },
    syncRunner: { runForCompany: async () => { await gate; } }, // hangs until released
    logger: silentLogger,
  });

  const first = scheduler.tick();      // starts, awaits the gate (inFlight = true)
  const second = await scheduler.tick(); // should skip immediately
  assert.equal(second.skipped, true);
  assert.equal(second.ran, 0);

  release();
  const firstResult = await first;
  assert.equal(firstResult.ran, 1);
});

test('tick handles a failure listing companies gracefully', async () => {
  const scheduler = createScheduler({
    installStore: {
      listConnectedCompanyIds: async () => {
        throw new Error('db down');
      },
    },
    syncRunner: { runForCompany: async () => {} },
    logger: silentLogger,
  });
  const result = await scheduler.tick();
  assert.deepEqual(result, { ran: 0, total: 0 });
});

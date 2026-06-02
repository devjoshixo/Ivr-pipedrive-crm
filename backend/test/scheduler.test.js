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

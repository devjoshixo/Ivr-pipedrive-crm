'use strict';

// Integration tests for the DB stores against a real MariaDB/MySQL. They run only
// when TEST_DATABASE_URL is set (point it at a throwaway database); otherwise they
// skip, so the default `npm test` and CI stay database-free.
// A TEST_DB_PREFIX may be set to exercise the table-prefix path.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test('db-stores (skipped — set TEST_DATABASE_URL to run)', { skip: true }, () => {});
} else {
  // eslint-disable-next-line global-require
  const { getPool, closePool } = require('../src/db/pool');
  const { tableNames } = require('../src/db/tables');
  const { splitStatements } = require('../src/db/migrate');
  const { createInstallStore } = require('../src/db/installStore');
  const { createSyncStore } = require('../src/db/syncStore');
  const { createMappingStore } = require('../src/db/mappingStore');
  const { createApiKeyStore } = require('../src/db/apiKeyStore');

  const PREFIX = process.env.TEST_DB_PREFIX || '';
  const pool = getPool(TEST_DB);
  const tables = tableNames(PREFIX);
  const encKey = crypto.randomBytes(32);
  const CO = `test-${crypto.randomBytes(4).toString('hex')}`;

  const installStore = createInstallStore(pool, encKey, tables);
  const syncStore = createSyncStore(pool, tables);
  const mappingStore = createMappingStore(pool, tables);
  const apiKeyStore = createApiKeyStore(pool, tables);

  test.before(async () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
    const sql = raw.replace(/\{\{PREFIX\}\}/g, PREFIX);
    for (const statement of splitStatements(sql)) {
      await pool.query(statement);
    }
    // Create the install row everything else FK-references.
    await installStore.saveIvrToken(CO, 'seed', false);
  });

  test.after(async () => {
    await pool.query(`DELETE FROM ${tables.installs} WHERE company_id = $1`, [CO]); // cascades
    await closePool();
  });

  test('installStore seals + round-trips the IVR token; plaintext not stored', async () => {
    await installStore.saveIvrToken(CO, 'super-secret-token', true);
    assert.equal(await installStore.getIvrToken(CO), 'super-secret-token');
    const { rows } = await pool.query(`SELECT ivr_token_sealed FROM ${tables.installs} WHERE company_id=$1`, [CO]);
    assert.ok(!rows[0].ivr_token_sealed.includes('super-secret-token'), 'stored sealed, not plaintext');
  });

  test('installStore persists Pipedrive tokens and lists connected companies', async () => {
    await installStore.savePipedriveTokens(CO, {
      companyDomain: 'acme',
      apiDomain: 'https://acme.pipedrive.com',
      accessToken: 'AT',
      refreshToken: 'RT',
      scope: 'contacts:full',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const inst = await installStore.getInstall(CO);
    assert.equal(inst.pd_access_token, 'AT');
    assert.equal(inst.pd_api_domain, 'https://acme.pipedrive.com');
    const ids = await installStore.listConnectedCompanyIds();
    assert.ok(ids.includes(CO), 'connected (has IVR token + refresh token)');
  });

  test('syncStore: cursors, dedupe, recording reconcile, stats', async () => {
    const cur0 = await syncStore.getCursors(CO);
    assert.deepEqual(cur0, { lastCallLogId: '', lastC2cLogId: '', lastDialerLogId: '' });

    await syncStore.markSeen(CO, {
      pbxCallId: 'rec-1', sipCallId: 'sip-1', pdCallLogId: 'cl-1', personId: 55,
      recordingUrl: 'https://r/1.wav', recordingAttached: false, source: 'sync',
    });
    const seen = await syncStore.filterSeen(CO, ['rec-1', 'rec-2']);
    assert.deepEqual([...seen], ['rec-1']);

    const bySip = await syncStore.getRealtimeBySip(CO, ['sip-1']);
    assert.equal(bySip.size, 0, 'source=sync is not a realtime row');

    // getBySip powers the late-note back-fill (any source, latest row).
    const row = await syncStore.getBySip(CO, 'sip-1');
    assert.equal(String(row.personId), '55'); // BIGINT comes back as a string from pg
    assert.equal(row.pbxCallId, 'rec-1');
    assert.equal(await syncStore.getBySip(CO, 'nope'), null);

    await syncStore.markRecordingAttached(CO, 'sip-1', { recordingUrl: 'https://r/1.wav', attached: true });
    const recents = await syncStore.recentForPerson(CO, 55);
    assert.equal(recents[0].recordingUrl, 'https://r/1.wav');

    await syncStore.saveCursors(CO, { lastCallLogId: '105', lastC2cLogId: '60', lastDialerLogId: '' });
    assert.equal((await syncStore.getCursors(CO)).lastCallLogId, '105');

    await syncStore.recordError(CO, 'WARN: test');
    assert.match((await syncStore.getSyncState(CO)).last_error, /WARN: test/);
    await syncStore.recordSuccess(CO);
    assert.equal((await syncStore.getSyncState(CO)).last_error, null);

    const stats = await syncStore.getStats(CO);
    assert.equal(stats.total, 1);
    assert.equal(stats.people, 1);
  });

  test('mappingStore: save, list, lookup by user and by extension', async () => {
    await mappingStore.saveMapping(CO, { pdUserId: '31751199', did: '+918044475500', extension: '201' });
    const list = await mappingStore.listMappings(CO);
    assert.equal(list[0].extension, '201');
    assert.deepEqual(await mappingStore.getForUser(CO, '31751199'), { did: '+918044475500', extension: '201' });
    assert.equal(await mappingStore.getUserByExtension(CO, '201'), '31751199');
  });

  test('apiKeyStore: regenerate, resolve, meta — hash only', async () => {
    const { key, prefix } = await apiKeyStore.regenerate(CO);
    assert.ok(key.startsWith('ivrpd_'));
    assert.equal(await apiKeyStore.resolveCompany(key), CO);
    assert.equal(await apiKeyStore.resolveCompany('ivrpd_wrong'), null);
    const meta = await apiKeyStore.getMeta(CO);
    assert.equal(meta.prefix, prefix);
    // Raw key must not be stored.
    const { rows } = await pool.query(`SELECT key_hash FROM ${tables.apiKeys} WHERE company_id=$1`, [CO]);
    assert.notEqual(rows[0].key_hash, key);
  });
}

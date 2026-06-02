'use strict';

// Apply schema.sql to the configured database. Run with: npm run migrate
// Idempotent (schema uses CREATE TABLE IF NOT EXISTS).

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../config');
const { getPool, closePool } = require('./pool');

async function migrate() {
  const config = loadConfig();
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const pool = getPool(config.databaseUrl);
  await pool.query(sql);
  // eslint-disable-next-line no-console
  console.log('Migration applied.');
  await closePool();
}

migrate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', err.message);
  process.exit(1);
});

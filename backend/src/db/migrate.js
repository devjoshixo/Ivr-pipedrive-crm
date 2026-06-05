'use strict';

// Apply schema.sql to the configured database. Run with: npm run migrate
// Idempotent (CREATE TABLE IF NOT EXISTS). Substitutes the table prefix and runs
// each statement separately (multipleStatements is disabled on the pool).

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../config');
const { getPool, closePool } = require('./pool');
const { sanitizePrefix } = require('./tables');

/** Strip `--` comment lines and split a SQL script into individual statements. */
function splitStatements(sql) {
  const noComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function migrate() {
  const config = loadConfig();
  const prefix = sanitizePrefix(config.tablePrefix);
  const raw = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const sql = raw.replace(/\{\{PREFIX\}\}/g, prefix);
  const pool = getPool(config.databaseUrl);
  for (const statement of splitStatements(sql)) {
    await pool.query(statement);
  }
  // eslint-disable-next-line no-console
  console.log(`Migration applied${prefix ? ` (prefix: ${prefix})` : ''}.`);
  await closePool();
}

// Only run when invoked directly (`node migrate.js` / `npm run migrate`), not when
// required for splitStatements (e.g. by the DB tests).
if (require.main === module) {
  migrate().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { splitStatements, migrate };

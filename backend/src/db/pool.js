'use strict';

// Lazily-created singleton Postgres pool. Kept lazy so unit tests (and the
// token-validation slice) don't require a live database at import time.

let pool = null;

/**
 * @param {string} databaseUrl
 * @returns {import('pg').Pool}
 */
function getPool(databaseUrl) {
  if (pool) return pool;
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, closePool };

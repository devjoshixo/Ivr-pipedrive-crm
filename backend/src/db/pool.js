'use strict';

// Lazily-created singleton MariaDB/MySQL pool (driver: mysql2). Kept lazy so unit
// tests don't require a live database at import time.
//
// The stores are written with Postgres-style `$1, $2` placeholders and expect a
// `{ rows }` result shape. This wrapper translates `$n` -> `?` (mysql2's positional
// placeholder, with array expansion for `IN (?)`) and normalises the result so the
// store code stays driver-agnostic.

let pool = null;

/** Translate `$1, $2, ...` to `?`, returning the SQL plus the 1-based arg order. */
function translatePlaceholders(text) {
  const order = [];
  const sql = String(text).replace(/\$(\d+)/g, (_, n) => {
    order.push(Number(n));
    return '?';
  });
  return { sql, order };
}

function makeQuery(raw) {
  return async function query(text, params = []) {
    const { sql, order } = translatePlaceholders(text);
    const args = order.map((i) => params[i - 1]);
    // mysql2's `query` (not `execute`) expands array args for `IN (?)`.
    const [rows] = await raw.query(sql, args);
    return { rows };
  };
}

/**
 * @param {string} databaseUrl - mysql://user:pass@host:port/db
 * @returns {{query: Function, end: Function, _raw: object}}
 */
function getPool(databaseUrl) {
  if (pool) return pool;
  // eslint-disable-next-line global-require
  const mysql = require('mysql2/promise');
  const u = new URL(databaseUrl);
  const raw = mysql.createPool({
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    connectionLimit: 10,
    timezone: 'Z', // store/read DATETIME as UTC, matching the previous Postgres behaviour
    multipleStatements: false, // migrate splits statements itself; keep this off
    dateStrings: false, // DATETIME -> JS Date (parity with pg)
  });
  pool = { query: makeQuery(raw), end: () => raw.end(), _raw: raw };
  return pool;
}

async function closePool() {
  if (pool) {
    await pool._raw.end();
    pool = null;
  }
}

module.exports = { getPool, closePool, translatePlaceholders };

/**
 * Postgres access — `pg` Pool, plain SQL (T0 decision: no ORM).
 *
 * The pool is created lazily and only when DATABASE_URL is set. Until
 * the self-run Postgres machine is provisioned (BLOCKED in T1 — needs
 * the owner's Fly.io API token), `getPool()` returns null and the
 * health check honestly reports the database as "not_configured"
 * instead of faking a healthy database.
 */
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (pool) return pool;
  if (!config.databaseUrl) return null;
  if (config.databaseUrl.startsWith('pg-mem:')) {
    throw new Error(
      'pg-mem databases are only available through setPoolOverride() (tests / local dev server) — see server.js.',
    );
  }
  pool = new Pool({ connectionString: config.databaseUrl });
  pool.on('error', (error) => {
    console.error('[twin] idle Postgres client error:', error.message);
  });
  return pool;
}

/**
 * Test / local-dev override: lets the test suite and the local curl
 * check run the real routes against an in-memory pg-mem Postgres
 * (DATABASE_URL=pg-mem://...) with zero live infrastructure. The
 * override is only ever installed by tests or by server.js's explicit
 * pg-mem branch — never on Fly, where DATABASE_URL is a real Postgres
 * connection string. The SQL is identical either way.
 */
export function setPoolOverride(nextPool) {
  pool = nextPool;
}

/** Honest DB status for /health: never throws, never leaks details. */
export async function checkDb() {
  const db = getPool();
  if (!db) return { status: 'not_configured', detail: 'DATABASE_URL is not set (Postgres not provisioned yet)' };
  try {
    await db.query('SELECT 1');
    return { status: 'ok' };
  } catch (error) {
    console.error('[twin] database health check failed:', error.message);
    return { status: 'error', detail: 'database unreachable' };
  }
}

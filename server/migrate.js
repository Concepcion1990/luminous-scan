/**
 * Migration runner — versioned SQL files under migrations/, applied in
 * filename order at server start (T1 skeleton).
 *
 * Applied files are recorded in `schema_migrations` (created by the
 * runner itself), so a re-run is a no-op and a half-applied migration
 * is never silently re-applied. Each file runs inside one transaction.
 * When DATABASE_URL is not set (Postgres not provisioned yet) the
 * runner skips with a warning instead of failing the boot — the twin
 * serves public pages without a database in T1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => path.join(dir, name));
}

export async function runMigrations() {
  const pool = getPool();
  if (!pool) {
    console.warn('[twin] skipping migrations — DATABASE_URL is not set (Postgres not provisioned yet).');
    return { applied: [], skipped: true };
  }
  const files = listMigrationFiles();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
    const appliedRows = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map((row) => row.filename));
    const newlyApplied = [];
    for (const file of files) {
      const filename = path.basename(file);
      if (applied.has(filename)) continue;
      const sql = fs.readFileSync(file, 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      newlyApplied.push(filename);
      console.log(`[twin] applied migration ${filename}`);
    }
    await client.query('COMMIT');
    return { applied: newlyApplied, skipped: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { config };

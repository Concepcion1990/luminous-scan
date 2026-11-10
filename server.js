/**
 * Luminous Stockhaven twin — Express entry point (T1 skeleton).
 *
 * REPLACES the old Luminous Scan `server.js` (Shopify OAuth, shops.json
 * token store, demo products). That file stays in git history only; the
 * twin's server does not use Shopify, demo mode, or shops.json.
 *
 * T2 scope: everything in T1 plus the auth + business API
 * (server/authRoutes.js). Migrations run at startup when a database
 * is configured. No Stripe, no Base44 — those land in later phases.
 *
 * DATABASE_URL=pg-mem://... runs the server against an in-memory
 * pg-mem Postgres (LOCAL DEV / TESTS ONLY — never on Fly). It exists
 * so the full register -> verify -> login loop can be exercised
 * before the Fly Postgres is provisioned; the SQL is identical.
 */
import { createApp } from './server/app.js';
import { config, configuredSecretNames } from './server/config.js';
import { runMigrations } from './server/migrate.js';
import { setPoolOverride } from './server/db.js';

const app = createApp();

async function main() {
  const configured = configuredSecretNames();
  console.log(
    `[twin] starting (env: ${config.nodeEnv}; secrets configured: ${configured.join(', ') || 'none'})`,
  );
  if (!config.sessionSecret) {
    console.warn('[twin] SESSION_SECRET is not set — sessions cannot start until it is set as a Fly secret.');
  }
  if (config.databaseUrl.startsWith('pg-mem:')) {
    if (config.nodeEnv === 'production') {
      throw new Error('pg-mem databases are not allowed in production.');
    }
    const { newDb } = await import('pg-mem');
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    setPoolOverride(new Pool());
    console.warn('[twin] using in-memory pg-mem Postgres (local dev only — data is lost on restart).');
  }
  await runMigrations();
  app.listen(config.port, () => {
    console.log(`[twin] Luminous Stockhaven listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error('[twin] failed to start:', error);
  process.exit(1);
});

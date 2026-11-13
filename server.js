/**
 * Luminous StockHaven twin — Express entry point (T1 skeleton).
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
import { setPoolOverride, getPool } from './server/db.js';
import { runWipeSweep } from './server/billing.js';
import { runTrialReminderSweep } from './server/trialReminders.js';

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
  // Wipe sweep (T4): the daily job that deletes accounts 15 days after
  // paid-through (keeping the TrialHistory row). Wired as a server
  // timer when BILLING_JOBS_ENABLED is exactly 'true' — the future
  // worker machine will call POST /api/billing/wipe-sweep with the
  // job secret instead. Off by default; the endpoint is the manual
  // trigger either way.
  if (process.env.BILLING_JOBS_ENABLED === 'true') {
    const runSweep = async () => {
      try {
        const pool = getPool();
        if (pool) await runWipeSweep(pool, { now: new Date() });
      } catch (error) {
        console.error('[twin] wipe sweep failed:', error.message);
      }
    };
    setInterval(runSweep, 24 * 60 * 60 * 1000);
    console.log('[twin] wipe sweep timer enabled (daily).');
    // Trial reminder sweep (owner decision 2026-11-12: reminders ON):
    // hourly, because the final reminder is a 24-hours-before email —
    // a daily cadence could land it a day late. Runs once at startup
    // too, so a restart never delays a due reminder by a full hour.
    // The job endpoint POST /api/billing/trial-reminder-sweep is the
    // manual/worker trigger either way, exactly like the wipe sweep.
    const runReminders = async () => {
      try {
        const pool = getPool();
        if (pool) await runTrialReminderSweep(pool, { now: new Date() });
      } catch (error) {
        console.error('[twin] trial reminder sweep failed:', error.message);
      }
    };
    void runReminders();
    setInterval(runReminders, 60 * 60 * 1000);
    console.log('[twin] trial reminder sweep timer enabled (hourly).');
  }
  app.listen(config.port, () => {
    console.log(`[twin] Luminous StockHaven listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error('[twin] failed to start:', error);
  process.exit(1);
});

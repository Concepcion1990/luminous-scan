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
import { startSweepScheduler } from './server/sweepScheduler.js';
import { startMissedClockOutScheduler, convertLegacyClockTicks } from './server/clockAdmin.js';
import { startPhotoJobScheduler } from './server/photoJobs.js';

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
  // The clock tick split (Nov 24, 2026): stored grants of the
  // retired single staff.clock tick become the two new ticks
  // before the first request lands. Idempotent — a no-op once
  // every row is converted.
  const convertedTicks = await convertLegacyClockTicks(getPool());
  if (convertedTicks > 0) {
    console.log(`[twin] converted ${convertedTicks} legacy staff.clock grant(s) to the split ticks`);
  }
  app.listen(config.port, () => {
    console.log(`[twin] Luminous StockHaven listening on port ${config.port}`);
    // Billing sweeps (Nov 18, 2026): the wipe sweep (T4 — deletes
    // accounts 15 days after paid-through, keeping the TrialHistory
    // row; the 90-day customer address purge rides it), and the
    // trial reminder sweep (owner decision 2026-11-12: reminders
    // ON). They used to be timers gated on BILLING_JOBS_ENABLED
    // being exactly 'true' — a flag production never carried, so
    // nothing ever ran and a due day-4 reminder email was never
    // sent. The scheduler (server/sweepScheduler.js) now rings on
    // its own: a boot run shortly after listen, then every 6
    // hours, ON unless BILLING_JOBS_ENABLED is exactly 'false'.
    // The job endpoints POST /api/billing/wipe-sweep and
    // POST /api/billing/trial-reminder-sweep stay as the manual
    // door either way.
    startSweepScheduler({ getPoolFn: getPool });
    // The missed-clock-out bell watch (Nov 21, 2026): rings the
    // owner and ticked managers once when a scheduled shift ends
    // with no clock-out. The flag itself is computed live on
    // every entries read; this only lands the bell.
    startMissedClockOutScheduler({ getPoolFn: getPool });
    // The photo job worker (release 366, Nov 24, 2026): drains
    // the durable photo_jobs queue — import photos arrive on
    // their own, politely and with retries, instead of being
    // fetched inside the import request. The import and
    // recovery doors also kick a drain when they enqueue, so
    // this tick is the guarantee, not the only road.
    startPhotoJobScheduler({ getPoolFn: getPool });
  });
}

main().catch((error) => {
  console.error('[twin] failed to start:', error);
  process.exit(1);
});

/**
 * Luminous Stockhaven twin — Express entry point (T1 skeleton).
 *
 * REPLACES the old Luminous Scan `server.js` (Shopify OAuth, shops.json
 * token store, demo products). That file stays in git history only; the
 * twin's server does not use Shopify, demo mode, or shops.json.
 *
 * T1 scope: serve the Vite build as static files (SPA fallback), answer
 * GET /health (app + database status, never secrets), answer
 * GET /api/auth/me with 401 while no session exists (auth is T2), and
 * apply pending SQL migrations at startup when DATABASE_URL is set.
 * No Stripe, no email, no Base44 — those land in later phases.
 */
import { createApp } from './server/app.js';
import { config, configuredSecretNames } from './server/config.js';
import { runMigrations } from './server/migrate.js';

const app = createApp();

async function main() {
  const configured = configuredSecretNames();
  console.log(
    `[twin] starting (env: ${config.nodeEnv}; secrets configured: ${configured.join(', ') || 'none'})`,
  );
  if (!config.sessionSecret) {
    console.warn('[twin] SESSION_SECRET is not set — sessions (T2) cannot start until it is set as a Fly secret.');
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

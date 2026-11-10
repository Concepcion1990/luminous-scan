/**
 * Twin configuration — env only, never hardcoded, never committed.
 *
 * Fly secrets (set with `fly secrets set ...`, never in the repo):
 *   DATABASE_URL     Postgres connection string (self-run machine, T1+)
 *   SESSION_SECRET   signs session cookies (used from T2 auth)
 *   EMAIL_API_KEY    Resend key (T2, email sending)
 *   STRIPE_*         Stripe keys (T4, test mode first; live gated)
 *
 * Only the NAMES of configured secrets are ever logged, never values.
 */

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
};

const SECRET_NAMES = ['DATABASE_URL', 'SESSION_SECRET', 'EMAIL_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];

export function configuredSecretNames() {
  return SECRET_NAMES.filter((name) => Boolean(process.env[name]));
}

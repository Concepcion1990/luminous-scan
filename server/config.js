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
  resendApiKey: process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeLiveEnabled: process.env.STRIPE_LIVE_ENABLED || '',
  stripeTestPriceEssentials: process.env.STRIPE_TEST_PRICE_ESSENTIALS || '',
  stripeTestPriceBusiness: process.env.STRIPE_TEST_PRICE_BUSINESS || '',
  billingJobSecret: process.env.BILLING_JOB_SECRET || '',
  billingJobsEnabled: process.env.BILLING_JOBS_ENABLED || '',
  // POS phase: Square OAuth + webhook signing, Shopify webhook HMAC.
  squareAppId: process.env.SQUARE_APP_ID || '',
  squareAppSecret: process.env.SQUARE_APP_SECRET || '',
  squareWebhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '',
  shopifyApiSecret: process.env.SHOPIFY_API_SECRET || '',
};

const SECRET_NAMES = ['DATABASE_URL', 'SESSION_SECRET', 'RESEND_API_KEY', 'EMAIL_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_JOB_SECRET', 'SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_WEBHOOK_SIGNATURE_KEY', 'SHOPIFY_API_SECRET'];

export function configuredSecretNames() {
  return SECRET_NAMES.filter((name) => Boolean(process.env[name]));
}

/**
 * Twin Express app (T3: auth + businesses + core shop).
 *
 * Routes:
 *   GET  /health          app + database status; never includes secrets.
 *   POST /api/auth/*      register, verify, resend-otp, login, logout,
 *                         forgot-password, reset-password (server/authRoutes.js)
 *   GET  /api/auth/me     the signed-in user, or 401.
 *   PATCH /api/auth/me    switch the active business (membership-checked).
 *   GET  /api/businesses  the caller's businesses.
 *   POST /api/businesses  create a business (Essentials 1-business cap).
 *   POST /api/businesses/:id/switch  switch the active business.
 *   /api/entities/*       generic Base44-shaped entity API (T3).
 *   /api/businesses/:id/* scan, movements, import, export, valuation,
 *                         dashboard, alerts, cross-business move, staff.
 *   POST /api/billing/*       Stripe billing (T4).
 *   POST /webhooks/stripe      Stripe webhook (raw body, HMAC verified).
 *   GET  /api/csrf-token       fresh CSRF token for the signed-in session (T6.1);
 *                              every mutating /api call sends it as X-CSRF-Token.
 *   GET  /*               the Vite build (dist/) with an SPA fallback.
 *
 * Unknown API paths fail closed with 404 — never a fake success.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDb, getPool } from './db.js';
import { createAuthRouter } from './authRoutes.js';
import { createShopRouter } from './shopRoutes.js';
import { createT6Router } from './t6Routes.js';
import { createWorkforceRouter } from './workforceRoutes.js';
import { createTrainingRouter } from './trainingRoutes.js';
import { createBillingRouter, stripeWebhookHandler } from './billingRoutes.js';
import { issueCsrfToken, requireCsrf } from './csrf.js';
import { requireAuth } from './sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const startedAt = Date.now();

export function createApp() {
  const app = express();
  // Trust the Fly proxy (one hop) so req.protocol / req.ip respect
  // X-Forwarded-Proto / X-Forwarded-For — needed for Secure cookies
  // and for the password-reset link's scheme.
  app.set('trust proxy', 1);
  // Stripe webhook FIRST, before any JSON parsing: signature
  // verification needs the raw body untouched (T4).
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
  // 3 MB JSON bodies: a store logo (up to 2 MB as a data URL) must
  // reach the logo endpoint's own clear 400, not the parser's 413.
  app.use(express.json({ limit: '3mb' }));

  app.get('/health', async (_req, res) => {
    const db = await checkDb();
    res.json({
      status: 'ok',
      app: 'luminous-stockhaven-twin',
      phase: 'T6',
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      database: db,
    });
  });

  // T6.1 CSRF: enforcement sits AHEAD of every router, so all
  // mutating /api routes are covered in one place (auth, billing,
  // shop/entities, T6 sync + cross-store). The middleware itself
  // skips safe methods, the pre-auth endpoints, and requests with
  // no live session.
  app.use('/api', requireCsrf(getPool()));
  // The token endpoint (signed in only — the token is bound to the
  // caller's session). A GET, so the middleware passes it through.
  app.get('/api/csrf-token', requireAuth(getPool()), (req, res) => {
    res.json({ csrf_token: issueCsrfToken(req.sessionId) });
  });
  app.use('/api', createAuthRouter({ getPool }));
  // Billing BEFORE shop: the shop router applies requireAuth to every
  // request that reaches it, and the wipe-sweep job endpoint is
  // job-secret protected, not session protected — it must be reachable
  // without a session cookie. Billing routes carry their own auth
  // where they need it; unmatched /api/* paths fall through to shop.
  app.use('/api', createBillingRouter({ getPool }));
  // T6: offline sync, name search, cross-store, logo upload.
  app.use('/api', createT6Router({ getPool }));
  // Workforce: scheduling, time clock, time-off, tasks, payroll.
  app.use('/api', createWorkforceRouter({ getPool }));
  // Training: role-scoped lesson tracks, assignments, team progress.
  app.use('/api', createTrainingRouter({ getPool }));
  app.use('/api', createShopRouter({ getPool }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', detail: 'API route not implemented yet' });
  });

  app.use(express.static(DIST_DIR));
  // SPA fallback: every non-API GET serves the built app.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });

  return app;
}

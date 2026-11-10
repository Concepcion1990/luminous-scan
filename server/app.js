/**
 * Twin Express app (T2: auth + businesses).
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
 *   GET  /*               the Vite build (dist/) with an SPA fallback.
 *
 * Everything else (/api/*) is T3+. Unknown API paths fail closed
 * with 404 — never a fake success.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDb, getPool } from './db.js';
import { createAuthRouter } from './authRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const startedAt = Date.now();

export function createApp() {
  const app = express();
  // Trust the Fly proxy (one hop) so req.protocol / req.ip respect
  // X-Forwarded-Proto / X-Forwarded-For — needed for Secure cookies
  // and for the password-reset link's scheme.
  app.set('trust proxy', 1);
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    const db = await checkDb();
    res.json({
      status: 'ok',
      app: 'luminous-stockhaven-twin',
      phase: 'T2',
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      database: db,
    });
  });

  app.use('/api', createAuthRouter({ getPool }));

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

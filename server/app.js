/**
 * Twin Express app (T1 skeleton).
 *
 * Routes in T1:
 *   GET  /health       app + database status; never includes secrets.
 *   GET  /api/auth/me  401 while no session exists (auth is T2).
 *   GET  /*            the Vite build (dist/) with an SPA fallback so
 *                      react-router routes (/welcome, /plans, ...) serve
 *                      index.html and the client router takes over.
 *
 * Everything else (/api/*) is T2+. Unknown API paths fail closed
 * with 404 — never a fake success.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const startedAt = Date.now();

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    const db = await checkDb();
    res.json({
      status: 'ok',
      app: 'luminous-stockhaven-twin',
      phase: 'T1',
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      database: db,
    });
  });

  // Auth is T2: no sessions exist yet, so this always answers 401.
  // The client (`src/api/client.js` auth.me) treats that as signed-out.
  app.get('/api/auth/me', (_req, res) => {
    res.status(401).json({ error: 'not_signed_in' });
  });

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

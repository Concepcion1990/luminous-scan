/**
 * Twin Express app (T3: auth + businesses + core shop).
 *
 * Routes:
 *   GET  /health          app + database status; never includes secrets.
 *   POST /api/auth/*      register, verify, resend-otp, login, logout,
 *                         forgot-password, reset-password (server/authRoutes.js)
 *   GET  /api/auth/me     the signed-in user, or 401.
 *   PATCH /api/auth/me    switch the active business (membership-checked) / set the account language.
 *   GET  /api/businesses  the caller's businesses.
 *   POST /api/businesses  create a business (Essentials 1-business cap).
 *   POST /api/businesses/:id/switch  switch the active business.
 *   /api/entities/*       generic Base44-shaped entity API (T3).
 *   /api/businesses/:id/* scan, movements, import, export, valuation,
 *                         dashboard, alerts, cross-business move, staff.
 *   POST /api/billing/*       Stripe billing (T4).
 *   POST /api/support/report  in-app problem reports (account-level,
 *                         any plan or none — never subscription-gated).
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
import { createRewardsRouter } from './rewardsRoutes.js';
import { createPosRouter } from './posRoutes.js';
import { createStorefrontRouter } from './ebayRoutes.js';
import { squareWebhookHandler, squareOAuthCallbackHandler } from './posSquare.js';
import { ebayWebhookHandler, ebayChallengeHandler, ebayOAuthCallbackHandler } from './posEbay.js';
import { shopifyWebhookHandler } from './posShopify.js';
import { cloverWebhookHandler, cloverOAuthCallbackHandler } from './posClover.js';
import { toastWebhookHandler } from './posToast.js';
import { lightspeedWebhookHandler } from './posLightspeed.js';
import { zettleWebhookHandler } from './posZettle.js';
import { stripeTerminalWebhookHandler } from './posStripeTerminal.js';
import { wixWebhookHandler } from './posWix.js';
import { createTrainingRouter } from './trainingRoutes.js';
import { createBillingRouter, stripeWebhookHandler } from './billingRoutes.js';
import { createRecoveryRouter } from './recoveryRoutes.js';
import { createSupportRouter } from './supportRoutes.js';
import { createBusinessPolicyRouter } from './businessPolicyRoutes.js';
import { createPolicyQuizRouter } from './policyQuizRoutes.js';
import { createCustomTrainingRouter } from './customTrainingRoutes.js';
import { createBarcodePoolRouter } from './barcodePoolRoutes.js';
import { createChecklistsRouter } from './checklistsRoutes.js';
import { createFoodSafetyRouter } from './foodSafetyRoutes.js';
import { createGuestMenuRouter } from './guestMenuRoutes.js';
import { createProfilePhotoRouter } from './profilePhotoRoutes.js';
import { createXstoreMessageRouter } from './xstoreMessageRoutes.js';
import { createCompRouter } from './compRoutes.js';
import { createBlocklistRouter } from './blocklistRoutes.js';
import { createStaffDocumentRouter } from './staffDocumentRoutes.js';
import { createRestaurantFileRouter } from './restaurantFileRoutes.js';
import { createDeletionRouter } from './deletionRoutes.js';
import { assertSubscriptionAccess } from './subscriptionAccess.js';
import { ocrAssetsHandler } from './ocrAssets.js';
import { issueCsrfToken, requireCsrf } from './csrf.js';
import { SESSION_COOKIE, loadSessionUser, parseCookies, requireAuth } from './sessions.js';

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
  // POS webhooks (POS phase): same raw-body rule — Square's HMAC and
  // Shopify's HMAC are both computed over the untouched body.
  app.post('/webhooks/pos/square', express.raw({ type: '*/*' }), squareWebhookHandler);
  app.post('/webhooks/pos/shopify', express.raw({ type: '*/*' }), shopifyWebhookHandler);
  // POS provider expansion (Nov 14, 2026): the six remaining
  // providers over the same shared core — each adapter verifies
  // its own documented signature scheme over the raw body.
  // Lightspeed destinations carry the store's domain prefix (the
  // per-retailer target URL its webhook registration uses).
  app.post('/webhooks/pos/clover', express.raw({ type: '*/*' }), cloverWebhookHandler);
  app.post('/webhooks/pos/toast', express.raw({ type: '*/*' }), toastWebhookHandler);
  app.post('/webhooks/pos/lightspeed/:storeKey', express.raw({ type: '*/*' }), lightspeedWebhookHandler);
  app.post('/webhooks/pos/zettle', express.raw({ type: '*/*' }), zettleWebhookHandler);
  app.post('/webhooks/pos/stripe-terminal', express.raw({ type: '*/*' }), stripeTerminalWebhookHandler);
  app.post('/webhooks/pos/wix', express.raw({ type: '*/*' }), wixWebhookHandler);
  // Square OAuth callback: a browser redirect from Square, no
  // session — the HMAC-signed state is its credential.
  app.get('/api/pos/square/callback', squareOAuthCallbackHandler);
  // eBay storefront notifications (release 362) — the same
  // raw-body treatment: signature verification needs the exact
  // bytes. The GET on the same path is eBay's destination
  // verification challenge. eBay is a storefront, so its
  // callback and routes carry no plan gate (both plans).
  app.post('/webhooks/pos/ebay', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    ebayWebhookHandler(req, res).catch((error) => {
      console.error('[twin] eBay webhook failed:', error);
      if (!res.headersSent) res.status(500).json({ error: 'server_error' });
    });
  });
  app.get('/webhooks/pos/ebay', (req, res) => {
    ebayChallengeHandler(req, res).catch((error) => {
      console.error('[twin] eBay challenge failed:', error);
      if (!res.headersSent) res.status(500).json({ error: 'server_error' });
    });
  });
  app.get('/api/pos/ebay/callback', ebayOAuthCallbackHandler);
  // Clover OAuth callback: same shape — a browser redirect from
  // Clover, the HMAC-signed state is its credential.
  app.get('/api/pos/clover/callback', cloverOAuthCallbackHandler);
  // Voice notes (Nov 19, 2026): a 3-minute recording travels as a
  // base64 data URL (~11 MB worst case) and must reach the voice
  // endpoint's own clear 400, not the parser's 413 — so that one
  // path gets a wider parser first; everything else keeps 3 MB.
  app.use(
    '/api/businesses/:bid/workforce/messages/threads/:threadId/voice',
    express.json({ limit: '12mb' }),
  );
  // Supplier invoice files (release 361): her universal
  // ruling (Nov 23, 2026) caps every upload in the app at
  // 25 MB — a 25 MB file travels as ~33 MB of base64, so
  // this one path gets a parser wide enough to reach the
  // route's own clear refusal, not the parser's 413.
  app.use(
    '/api/businesses/:bid/restaurant/invoices/:invoiceId/file',
    express.json({ limit: '40mb' }),
  );
  // The universal 25 MB upload sweep (owner ruling, Nov 23, 2026):
  // every remaining upload door now takes files up to 25 MB, and
  // each of those doors' paths gets the same widened parser, so an
  // over-size file reaches the door's own plain refusal in the
  // reader's language — never the parser's 413. (The POS CSV door
  // sends its file as JSON text rather than base64; 40 MB covers
  // a 25 MB sheet with room to spare.)
  app.use(
    [
      '/api/businesses/:bid/logo',
      '/api/businesses/:bid/product-photos',
      '/api/businesses/:bid/orders/:oid/shipping-label',
      '/api/businesses/:bid/staff-documents/:memberId',
      '/api/businesses/:bid/food-safety/sds',
      '/api/businesses/:bid/policies/:kind/file',
      '/api/businesses/:bid/own-training/:id/file',
      '/api/businesses/:bid/profile-photos/me',
      '/api/businesses/:bid/pos/csv-import',
    ],
    express.json({ limit: '40mb' }),
  );
  // 3 MB JSON bodies for everything else: an ordinary request
  // must still reach its endpoint's own clear answer, not the
  // parser's 413.
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
  // Product photos (Nov 14, 2026): PUBLIC by design — the product
  // form promises "anyone with the link can open them", and the id
  // is an unguessable UUID. Bytes live in Postgres (migration 020)
  // so they survive deploys. A GET, so CSRF passes it through; no
  // session is consulted, which is also what lets marketplaces and
  // shared links render the image.
  app.get('/api/photos/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(404).json({ error: 'photo_not_found' });
    try {
      const { rows } = await pool.query(
        'SELECT content_type, data_base64 FROM product_photos WHERE id = $1',
        [req.params.id],
      );
      const photo = rows[0];
      if (!photo) return res.status(404).json({ error: 'photo_not_found' });
      res.setHeader('Content-Type', photo.content_type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(Buffer.from(photo.data_base64, 'base64'));
    } catch (error) {
      console.error('[twin] photo serve failed:', error.message);
      return res.status(404).json({ error: 'photo_not_found' });
    }
  });
  // The token endpoint (signed in only — the token is bound to the
  // caller's session). A GET, so the middleware passes it through.
  app.get('/api/csrf-token', requireAuth(getPool()), (req, res) => {
    res.json({ csrf_token: issueCsrfToken(req.sessionId) });
  });
  // Recovery-kit scope guard (T7): a scope='recovery' session — the
  // short-lived session a spare key mints — may reach ONLY the
  // change-email flow, its own session housekeeping, and the CSRF
  // token endpoint. Everything else under /api is refused, so a
  // recovery session can never browse or touch the shop. Enforced
  // here, ahead of every router, so no route can forget the check.
  const RECOVERY_ALLOWED = new Set([
    'GET /api/auth/me',
    'POST /api/auth/logout',
    'POST /api/account/change-email/request',
    'POST /api/account/change-email/confirm',
  ]);
  app.use('/api', async (req, res, next) => {
    try {
      const pool = getPool();
      if (!pool) return next();
      const cookies = parseCookies(req);
      if (!cookies[SESSION_COOKIE]) return next();
      const loaded = await loadSessionUser(pool, cookies[SESSION_COOKIE]);
      if (!loaded || loaded.scope !== 'recovery') return next();
      // NOTE: req.path is mount-stripped inside app.use('/api', …) —
      // originalUrl carries the full path the allowlist is written in.
      const fullPath = String(req.originalUrl || '').split('?')[0];
      if (RECOVERY_ALLOWED.has(`${req.method} ${fullPath}`)) return next();
      return res.status(403).json({
        error: 'recovery_scope',
        message: 'This sign-in can only finish changing your account email. Complete that step — or sign in normally — to use the rest of the app.',
      });
    } catch (error) {
      console.error('[twin] recovery scope check failed:', error.message);
      return res.status(403).json({ error: 'recovery_scope' });
    }
  });
  // Subscription access gate (2026-11-13, pre-launch loophole fix):
  // the screen gate (SubscriptionAccessRoute) is not enough — the
  // business DATA routes must refuse unpaid workspaces too, or a
  // signed-in customer could skip /plans and use the API directly.
  // This middleware covers every /api/businesses/:bid/* surface in
  // one place (shop, T6 sync/cross-store, workforce, rewards, POS,
  // training, the Settings business PATCH, the recovery staff-email
  // fix) so a future router cannot forget the check. The generic
  // entity API is gated inside server/entities.js (its business id
  // travels in filters/rows, not the path). Exempt here: business
  // switch (workspace selection) and the entitlement read itself —
  // both are pre-checkout essentials. Business list/create are not
  // under this prefix at all. Requests with no live session pass
  // through: the routers answer their own 401.
  const BUSINESS_PATH = /^\/api\/businesses\/([^/]+)(\/.*)?$/;
  app.use('/api', async (req, res, next) => {
    try {
      const fullPath = String(req.originalUrl || '').split('?')[0];
      const match = BUSINESS_PATH.exec(fullPath);
      if (!match) return next();
      if (req.method === 'POST' && /^\/api\/businesses\/[^/]+\/switch$/.test(fullPath)) return next();
      if (req.method === 'GET' && /^\/api\/businesses\/[^/]+\/entitlement$/.test(fullPath)) return next();
      const pool = getPool();
      if (!pool) return next();
      const cookies = parseCookies(req);
      if (!cookies[SESSION_COOKIE]) return next();
      const loaded = await loadSessionUser(pool, cookies[SESSION_COOKIE]);
      if (!loaded || loaded.scope === 'recovery') return next();
      const write = !['GET', 'HEAD'].includes(req.method);
      // broadRead: during the failed-payment road's view-only
      // days every read stays open (owner's ruling, Nov 20,
      // 2026 — staff can reach their own pay stubs); writes are
      // still refused. The flag changes nothing for any other
      // state (see assertSubscriptionAccess).
      await assertSubscriptionAccess(pool, loaded.user, match[1], { write, broadRead: true });
      return next();
    } catch (error) {
      if (error && error.status === 403) {
        return res.status(403).json({ error: error.code || 'subscription_required', message: error.message });
      }
      console.error('[twin] subscription access gate failed:', error.message);
      return res.status(403).json({ error: 'subscription_required' });
    }
  });
  app.use('/api', createAuthRouter({ getPool }));
  // Recovery kit: spare keys, backup email, change-email, recovery
  // entry, owner staff-email fix (server/recoveryRoutes.js).
  app.use('/api', createRecoveryRouter({ getPool }));
  // Support: in-app problem reporting (server/supportRoutes.js).
  // Account-level on purpose — NOT under /api/businesses/:bid/*, so
  // the subscription gate never stands between a customer and the
  // help door, on any plan or none.
  app.use('/api', createSupportRouter({ getPool }));
  // Account-deletion requests (server/deletionRoutes.js): the
  // Settings Delete Account flow's server side. Account-level on
  // purpose, like support — a request for review that deletes
  // nothing and touches no billing.
  app.use('/api', createDeletionRouter({ getPool }));
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
  // Rewards: Business-only staff incentives, inside the workforce area.
  app.use('/api', createRewardsRouter({ getPool }));
  // POS: till connections, mappings, CSV sales import (server/posRoutes.js).
  app.use('/api', createPosRouter({ getPool }));
  // Storefront connections (release 362): the eBay door — both plans, no plan gate.
  app.use('/api', createStorefrontRouter({ getPool }));
  // Training: role-scoped lesson tracks, assignments, team progress.
  app.use('/api', createTrainingRouter({ getPool }));
  // The owner's own store policies + terms (server/businessPolicyRoutes.js):
  // two per-business documents, owner-written, team-readable.
  app.use('/api', createBusinessPolicyRouter({ getPool }));
  // The owner's quiz on her own policies + terms (server/policyQuizRoutes.js):
  app.use('/api', createPolicyQuizRouter({ getPool }));
  // "Add your own training" (server/customTrainingRoutes.js): the
  // owner's own trainings + quizzes at the end of the Training
  // page — both plans, per-business private, tick-assigned.
  app.use('/api', createCustomTrainingRouter({ getPool }));
  // The barcode pool (server/barcodePoolRoutes.js): the Print
  // section's Generate barcodes door — owner-minted house codes
  // with no product attached, per-business, both plans.
  app.use('/api', createBarcodePoolRouter({ getPool }));
  // Checklists (server/checklistsRoutes.js): the checklist
  // engine — templates, scheduled instances, item completions
  // with proof — a general feature on both plans, per-business.
  app.use('/api', createChecklistsRouter({ getPool }));
  // The food-safety file (server/foodSafetyRoutes.js):
  // certificates on the staff-documents machinery, the
  // staff-readable SDS shelf, and the mock inspection on the
  // checklist engine — Business-only, per-business.
  app.use('/api', createFoodSafetyRouter({ getPool }));
  app.use('/api', createGuestMenuRouter({ getPool }));
  // Profile photos + the owner's display name
  // (server/profilePhotoRoutes.js): owner-approved team photos
  // and the name that replaces "Owner".
  app.use('/api', createProfilePhotoRouter({ getPool }));
  // Cross-store messages (server/xstoreMessageRoutes.js): the
  // account-scoped messaging door — everyone under one owner,
  // across all their businesses. Business-only; the in-store
  // inbox above is untouched by it.
  app.use('/api', createXstoreMessageRouter({ getPool }));
  // Founding-tester comp list (server/compRoutes.js): operator
  // only — the publisher identity is the only hand on it, and no
  // customer surface links here.
  app.use('/api', createCompRouter({ getPool }));
  // Signup domain blocklist (server/blocklistRoutes.js):
  // operator only — the publisher identity is the only hand on
  // it, and no customer surface links here.
  app.use('/api', createBlocklistRouter({ getPool }));
  // Staff documents (server/staffDocumentRoutes.js): each
  // member's paperwork file — owner + staff.documents-ticked
  // managers only, every version kept.
  app.use('/api', createStaffDocumentRouter({ getPool }));
  // Supplier invoice files (server/restaurantFileRoutes.js):
  // the paper copy on a supplier invoice, born at her
  // universal 25 MB upload cap (Nov 23, 2026).
  app.use('/api', createRestaurantFileRouter({ getPool }));
  app.use('/api', createShopRouter({ getPool }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', detail: 'API route not implemented yet' });
  });

  // OCR assets for the ISBN digits reader (Nov 19, 2026): the
  // tesseract.js worker, cores and language data, served from
  // server/ocrassets/ (base64-chunk delivery, sha256-verified at
  // load — see server/ocrAssets.js). Mounted before the static
  // dist serving so these names never hit the SPA fallback.
  app.get('/ocr-assets/:name', ocrAssetsHandler);

  // Cache posture for the built app (design-polish pass, 2026-11-13):
  // the shell document, the service worker script and the manifest
  // must revalidate on every load, so a new deploy is picked up on
  // the next visit — with express.static's defaults the browser could
  // heuristically cache all three, which is how a phone kept serving
  // the pre-fix build on 2026-11-12. The fingerprinted files under
  // /assets/ are the opposite: their names change with their content,
  // so they may be cached for a year, immutable.
  // `extensions: ['html']` is the prerendered public pages
  // (Nov 19, 2026): /plans resolves to dist/plans.html here —
  // a real file with the page's content baked in — instead of
  // falling through to the shell. Unknown paths still miss
  // static entirely and reach the SPA fallback below.
  app.use(express.static(DIST_DIR, {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (
        filePath.endsWith('.html')
        || filePath.endsWith('sw.js')
        || filePath.endsWith('manifest.webmanifest')
      ) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
    extensions: ['html'],
  }));
  // SPA fallback: every non-API GET serves the built app.
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });

  return app;
}

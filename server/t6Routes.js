/**
 * T6 routes — offline-first sync, name search, cross-store
 * availability + notify/request, and the store-logo upload.
 *
 *   POST /api/businesses/:bid/sync/apply     queued changes, idempotent
 *   GET  /api/businesses/:bid/sync/state     convergence version
 *   GET  /api/businesses/:bid/products/search?q=   lookup by name
 *   GET  /api/businesses/:bid/cross-store/availability?product_id=
 *   POST /api/businesses/:bid/cross-store/requests
 *   GET  /api/businesses/:bid/cross-store/requests   inbox + outgoing
 *        (T6.2: serves the cross-store inbox page; rows carry the
 *        asking and target store names so the page can name them)
 *   PATCH /api/businesses/:bid/cross-store/requests/:id
 *   POST /api/businesses/:bid/logo           store-logo upload (data URL)
 *
 * Cross-store is Business by nature: Essentials has one store, so
 * there is nowhere else to look — the server refuses it with
 * 403 whatever the browser shows. The multi-store lookup matches on
 * SKU first (the same product carried at another store); a product
 * with no SKU matches on its exact name.
 *
 * The logo upload stores the image as a data URL on the business
 * record (no file store, no third-party host, nothing leaves the
 * twin's own database). It is the STORE's branding: it appears in
 * the app chrome next to the store's name. Printed documents keep
 * carrying the store's business name and never the Luminous
 * StockHaven app logo (T5 white-label rule). The app name itself is
 * never changeable and is not part of any of these routes.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess, loadBusiness, loadBusinessesForUser } from './authz.js';
import { planFor, featureAllowed } from './plans.js';
import { assertNotInGrace } from './billing.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applySyncBatch, syncState } from './sync.js';
import { entityDef, publicRow } from './entities.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] t6 route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

async function accessOr403(pool, user, businessId, permission) {
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  if (permission && !access.can(permission)) {
    throw err(403, 'forbidden', 'You do not have permission to do that here.');
  }
  return access;
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function parseLogoDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1];
  if (!LOGO_TYPES.includes(mime)) return null;
  let bytes;
  try {
    bytes = Buffer.from(match[3], 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > LOGO_MAX_BYTES) return null;
  return { mime, bytes, dataUrl: text };
}

export function createT6Router({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };

  // ---- Offline-first sync -------------------------------------------
  router.post('/businesses/:bid/sync/apply', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'scan.use');
    await assertNotInGrace(pool(), req.params.bid);
    const changes = req.body?.changes;
    if (!Array.isArray(changes) || !changes.length) {
      throw err(400, 'invalid_value', 'Send at least one queued change.');
    }
    if (changes.length > 100) {
      throw err(400, 'invalid_value', 'Send at most 100 queued changes at a time.');
    }
    const result = await applySyncBatch(pool(), {
      businessId: req.params.bid,
      user: req.user,
      changes,
    });
    return res.json({ ...result, plan: access.planKey });
  }));

  router.get('/businesses/:bid/sync/state', asyncHandler(async (req, res) => {
    await accessOr403(pool(), req.user, req.params.bid);
    return res.json(await syncState(pool(), req.params.bid));
  }));

  // ---- Lookup by name (barcode won't scan) ---------------------------
  router.get('/businesses/:bid/products/search', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'scan.use');
    const q = String(req.query.q || '').trim();
    if (!q || q.length > 100) {
      throw err(400, 'invalid_value', 'Type a product name to search for.');
    }
    const { rows } = await pool().query(
      `SELECT * FROM products
        WHERE business_id = $1
          AND (name ILIKE $2 OR sku ILIKE $2 OR upc ILIKE $2 OR isbn ILIKE $2)
        ORDER BY name ASC LIMIT 10`,
      [req.params.bid, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
    );
    return res.json({ products: rows.map((row) => publicRow(entityDef('Product'), row)), plan: access.planKey });
  }));

  // ---- Cross-store availability + notify/request (Business only) -----
  async function businessOr403(businessId, user) {
    const access = await accessOr403(pool(), user, businessId);
    if (!featureAllowed(access.planKey, 'crossStore')) {
      throw err(
        403,
        'cross_store_business_only',
        'Looking across stores is part of the Business plan — Essentials has one store, so there is nowhere else to look.',
      );
    }
    return access;
  }

  /** Other businesses the caller owns, with this product's stock at each. */
  async function availabilityFor(product) {
    const owned = await loadBusinessesForUser(pool(), product.ownerId);
    // Subscription gate (2026-11-13): another store's stock is that
    // workspace's data — an unpaid/lapsed store contributes nothing
    // here either, even though the asking store is entitled.
    const entitled = [];
    for (const b of owned) {
      if (b.id === product.businessId) continue;
      if (await hasFullSubscriptionAccess(pool(), b.id)) entitled.push(b);
    }
    const others = entitled;
    const out = [];
    for (const other of others) {
      let match = null;
      if (String(product.sku || '').trim()) {
        const found = await pool().query(
          'SELECT * FROM products WHERE business_id = $1 AND sku = $2 LIMIT 1',
          [other.id, product.sku],
        );
        match = found.rows[0] ?? null;
      }
      if (!match) {
        const found = await pool().query(
          'SELECT * FROM products WHERE business_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
          [other.id, product.name],
        );
        match = found.rows[0] ?? null;
      }
      if (!match) continue;
      const levels = await pool().query(
        `SELECT l.*, loc.name AS location_name FROM stock_levels l
           LEFT JOIN locations loc ON loc.id = l.location_id
          WHERE l.business_id = $1 AND l.product_id = $2 AND l.quantity > 0
          ORDER BY l.quantity DESC`,
        [other.id, match.id],
      );
      const total = levels.rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
      if (total <= 0) continue;
      out.push({
        business_id: other.id,
        business_name: other.name,
        product_id: match.id,
        total,
        locations: levels.rows.map((row) => ({
          location_id: row.location_id,
          location_name: row.location_name || '',
          quantity: Number(row.quantity ?? 0),
        })),
      });
    }
    return out;
  }

  router.get('/businesses/:bid/cross-store/availability', asyncHandler(async (req, res) => {
    const access = await businessOr403(req.params.bid, req.user);
    const productId = String(req.query.product_id || '').trim();
    if (!productId) throw err(400, 'invalid_value', 'Choose a product to look up.');
    const { rows } = await pool().query(
      'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
      [productId, req.params.bid],
    );
    const product = rows[0];
    if (!product) throw err(404, 'not_found', 'Product not found in this store.');
    const here = await pool().query(
      'SELECT COALESCE(SUM(quantity), 0)::int AS total FROM stock_levels WHERE business_id = $1 AND product_id = $2',
      [req.params.bid, product.id],
    );
    const others = await availabilityFor({
      ...product,
      businessId: req.params.bid,
      // The other stores belong to the same owner as this store — a
      // staff member asking is asking their owner's other stores, not
      // their own (staff own no business).
      ownerId: access.business.owner_id,
    });
    return res.json({
      product_id: product.id,
      product_name: product.name,
      sku: product.sku || '',
      on_hand_here: Number(here.rows[0]?.total ?? 0),
      stores: others,
    });
  }));

  router.post('/businesses/:bid/cross-store/requests', asyncHandler(async (req, res) => {
    const access = await businessOr403(req.params.bid, req.user);
    await assertNotInGrace(pool(), req.params.bid);
    const body = req.body || {};
    const targetId = String(body.target_business_id || '').trim();
    const productId = String(body.product_id || '').trim();
    const mode = body.mode === 'bring' ? 'bring' : 'ship';
    const message = String(body.message || '').trim().slice(0, 500);
    if (!targetId || !productId) {
      throw err(400, 'invalid_value', 'Choose a product and the store to ask.');
    }
    if (targetId === req.params.bid) {
      throw err(400, 'invalid_value', 'Choose a different store to ask.');
    }
    const target = await loadBusiness(pool(), targetId);
    if (!target || target.owner_id !== req.user.id) {
      throw err(403, 'forbidden', 'You can only ask your own other stores.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
      [productId, req.params.bid],
    );
    const product = rows[0];
    if (!product) throw err(404, 'not_found', 'Product not found in this store.');
    // Only ask when the other store actually has it to send.
    const others = await availabilityFor({ ...product, businessId: req.params.bid, ownerId: access.business.owner_id });
    const targetHas = others.find((entry) => entry.business_id === targetId);
    if (!targetHas) {
      throw err(400, 'out_of_stock_elsewhere', 'That store does not have this item in stock right now.');
    }
    const id = crypto.randomUUID();
    const inserted = await pool().query(
      `INSERT INTO cross_store_requests
         (id, business_id, target_business_id, product_id, product_name, sku, mode, message, status, requested_by_id, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10) RETURNING *`,
      [id, req.params.bid, targetId, product.id, product.name, product.sku || '', mode, message, req.user.id, req.user.email],
    );
    return res.status(201).json({ request: inserted.rows[0], target_stock: targetHas.total, business_name: access.business.name });
  }));

  // Inbox for the target store's staff + outgoing for the asking store.
  // The joined names let the inbox say WHICH store asked (or was
  // asked) without a second round trip per row; the request rows
  // themselves carry no business names.
  router.get('/businesses/:bid/cross-store/requests', asyncHandler(async (req, res) => {
    await accessOr403(pool(), req.user, req.params.bid);
    const { rows } = await pool().query(
      `SELECT r.*,
              src.name AS business_name,
              tgt.name AS target_business_name
         FROM cross_store_requests r
         LEFT JOIN businesses src ON src.id = r.business_id
         LEFT JOIN businesses tgt ON tgt.id = r.target_business_id
        WHERE r.business_id = $1 OR r.target_business_id = $1
        ORDER BY r.created_at DESC LIMIT 100`,
      [req.params.bid],
    );
    return res.json({
      incoming: rows.filter((row) => row.target_business_id === req.params.bid),
      outgoing: rows.filter((row) => row.business_id === req.params.bid),
    });
  }));

  router.patch('/businesses/:bid/cross-store/requests/:id', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const status = String(req.body?.status || '').trim();
    if (!['acknowledged', 'resolved', 'declined'].includes(status)) {
      throw err(400, 'invalid_value', 'Choose acknowledged, resolved or declined.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM cross_store_requests WHERE id = $1 AND target_business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const request = rows[0];
    if (!request) throw err(404, 'not_found', 'Request not found for this store.');
    const updated = await pool().query(
      `UPDATE cross_store_requests SET status = $1, resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE id = $2 RETURNING *`,
      [status, req.params.id],
    );
    return res.json({ request: updated.rows[0], business_name: access.business.name });
  }));

  // ---- Store-logo upload ----------------------------------------------
  router.post('/businesses/:bid/logo', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!access.isOwner) {
      throw err(403, 'forbidden', 'Only the business owner can change the store logo.');
    }
    const parsed = parseLogoDataUrl(req.body?.dataUrl);
    if (!parsed) {
      throw err(
        400,
        'invalid_logo',
        'Send a PNG, JPG or WebP image under 2 MB.',
      );
    }
    const updated = await pool().query(
      'UPDATE businesses SET logo_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [parsed.dataUrl, req.params.bid],
    );
    return res.json({ logo_url: updated.rows[0].logo_url });
  }));

  return router;
}

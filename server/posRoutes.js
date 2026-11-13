/**
 * POS routes — till connections (POS phase).
 *
 *   GET  /api/businesses/:bid/pos/overview            connections + provider readiness + recent sales + held lines
 *   GET  /api/businesses/:bid/pos/events              recent POS sales (with lines)
 *   GET  /api/businesses/:bid/pos/unmatched           held lines (unmatched / insufficient stock)
 *   POST /api/businesses/:bid/pos/square/connect      OAuth start (or the plain not-configured answer)
 *   POST /api/businesses/:bid/pos/shopify/connect     per-store credential connect { shop_domain, access_token }
 *   POST /api/businesses/:bid/pos/connections/:provider/disconnect
 *   POST /api/businesses/:bid/pos/connections/:provider/location  { location_id } — which location the till deducts from
 *   POST /api/businesses/:bid/pos/mappings            { provider, provider_item_key, product_id }
 *   POST /api/businesses/:bid/pos/mappings/:id/apply-held
 *   POST /api/businesses/:bid/pos/csv-import          { csv } or { rows } — the end-of-day fallback
 *
 * The owner's decision (Nov 12, 2026): a sale at the till reflects
 * in the app's inventory. Square + Shopify POS share the core in
 * server/posCore.js; the webhooks live in the adapter files.
 *
 * PLAN GATE: BUSINESS ONLY (the owner's ruling, Nov 13, 2026:
 * "The tail connection should only be for business"). Every route
 * here refuses Essentials with the standard plan_gated error,
 * reads included — the Rewards enforcement, mirrored. The grace
 * rule still applies to the management writes here (read-only
 * workspace); till webhooks are the store's source of truth and
 * keep recording through grace — the 15-day read-only inventory
 * would otherwise silently lose real sales, and the wipe still
 * ends the account on schedule. Webhook sales that arrive while
 * the business is NOT on Business are recorded HELD FOR PLAN by
 * the adapters (see server/posCore.js) — never lost, never
 * applied — and apply from this page once it is Business again.
 *
 * Who manages: the owner or a manager (the workforce hierarchy).
 * Staff can look (their training lesson explains held sales) but
 * cannot connect, map or import.
 *
 * CREDENTIALS: pos_connections.credentials is NEVER selected into
 * a response — publicConnection() is a whitelist, and the POS
 * tests scan serialized responses for the stored token.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { personLevel } from './workforceRoutes.js';
import { featureAllowed } from './plans.js';
import { applyPosSale, parseSalesCsv, publicEvent, retryHeldLines } from './posCore.js';
import { squareConfig, squareAuthorizeUrl } from './posSquare.js';
import { shopifyConfig } from './posShopify.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] POS route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

/** The ONLY shape a connection ever takes on the wire — no credentials. */
export function publicConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    provider: row.provider,
    status: row.status,
    label: row.label || '',
    provider_account_id: row.provider_account_id || '',
    provider_location_id: row.provider_location_id || '',
    location_id: row.location_id || null,
    has_credentials: Boolean(row.credentials),
    last_error: row.last_error || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PROVIDERS = ['square', 'shopify'];

export function createPosRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/pos';

  async function ctx(req, { write = false } = {}) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'pos')) {
      throw err(403, 'plan_gated', 'Till connections are part of the Business plan.');
    }
    const level = access.isOwner ? 'owner' : personLevel(access.staffRow);
    if (write) {
      await assertNotInGrace(pool(), req.params.bid);
      if (level === 'staff') {
        throw err(403, 'forbidden', 'Till connections are managed by the owner or a manager.');
      }
    }
    return { access, level };
  }

  async function connectionFor(businessId, provider) {
    const { rows } = await pool().query(
      'SELECT * FROM pos_connections WHERE business_id = $1 AND provider = $2 LIMIT 1',
      [businessId, provider],
    );
    return rows[0] ?? null;
  }

  async function upsertConnection(businessId, provider, fields, user) {
    const existing = await connectionFor(businessId, provider);
    if (existing) {
      const merged = { ...existing, ...fields };
      const { rows } = await pool().query(
        `UPDATE pos_connections
            SET status = $1, label = $2, provider_account_id = $3, provider_location_id = $4,
                location_id = $5, credentials = $6, last_error = $7, updated_at = NOW()
          WHERE id = $8 RETURNING *`,
        [
          merged.status, merged.label || '', merged.provider_account_id || '',
          merged.provider_location_id || '', merged.location_id ?? null,
          merged.credentials || '', merged.last_error || '', existing.id,
        ],
      );
      return rows[0];
    }
    const { rows } = await pool().query(
      `INSERT INTO pos_connections
         (id, business_id, provider, status, label, provider_account_id, provider_location_id,
          location_id, credentials, last_error, created_by_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        crypto.randomUUID(), businessId, provider, fields.status || 'not_connected',
        fields.label || '', fields.provider_account_id || '', fields.provider_location_id || '',
        fields.location_id ?? null, fields.credentials || '', fields.last_error || '',
        user?.id ?? null, user?.email ?? null,
      ],
    );
    return rows[0];
  }

  async function recentEvents(businessId, limit) {
    const { rows } = await pool().query(
      'SELECT * FROM pos_sale_events WHERE business_id = $1 ORDER BY created_at DESC LIMIT $2',
      [businessId, limit],
    );
    const events = [];
    for (const row of rows) {
      const lines = await pool().query(
        'SELECT * FROM pos_sale_lines WHERE event_id = $1 ORDER BY created_at ASC',
        [row.id],
      );
      events.push(publicEvent(row, lines.rows));
    }
    return events;
  }

  async function heldLines(businessId) {
    const { rows } = await pool().query(
      `SELECT l.*, e.provider AS event_provider, e.external_sale_id, e.sold_at AS event_sold_at
         FROM pos_sale_lines l
         JOIN pos_sale_events e ON e.id = l.event_id
        WHERE l.business_id = $1 AND l.status IN ('unmatched', 'insufficient_stock')
        ORDER BY l.created_at DESC LIMIT 200`,
      [businessId],
    );
    return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
  }

  // ---- Overview -----------------------------------------------------------

  router.get(`${base}/overview`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    const connections = [];
    for (const provider of PROVIDERS) {
      const row = await connectionFor(req.params.bid, provider);
      connections.push(row ? publicConnection(row) : {
        provider, status: 'not_connected', label: '', provider_account_id: '',
        provider_location_id: '', location_id: null, has_credentials: false, last_error: '',
      });
    }
    const square = squareConfig();
    const shopify = shopifyConfig();
    const heldPlan = await pool().query(
      "SELECT COUNT(*)::int AS n FROM pos_sale_events WHERE business_id = $1 AND status = 'held_plan'",
      [req.params.bid],
    );
    return res.json({
      level,
      plan: access.planKey,
      held_plan_events: heldPlan.rows[0].n,
      connections,
      providers: {
        square: { oauth_configured: square.oauthConfigured, webhook_configured: square.webhookConfigured },
        shopify: { webhook_configured: shopify.webhookConfigured },
      },
      events: await recentEvents(req.params.bid, 25),
      held: await heldLines(req.params.bid),
    });
  }));

  router.get(`${base}/events`, asyncHandler(async (req, res) => {
    await ctx(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    return res.json({ events: await recentEvents(req.params.bid, limit) });
  }));

  router.get(`${base}/unmatched`, asyncHandler(async (req, res) => {
    await ctx(req);
    return res.json({ held: await heldLines(req.params.bid) });
  }));

  // ---- Connect: Square (OAuth start) ---------------------------------------

  router.post(`${base}/square/connect`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const url = squareAuthorizeUrl(req.params.bid);
    if (!url) {
      return res.json({
        provider: 'square',
        configured: false,
        message: 'Square connections are not switched on yet. Everything else — the CSV import below included — works today.',
      });
    }
    return res.json({ provider: 'square', configured: true, authorize_url: url });
  }));

  // ---- Connect: Shopify (per-store credential) ------------------------------

  router.post(`${base}/shopify/connect`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const body = req.body || {};
    const domain = String(body.shop_domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const token = String(body.access_token || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(domain)) {
      throw err(400, 'invalid_value', 'Enter your store domain, like your-store.myshopify.com.');
    }
    if (token.length < 8) {
      throw err(400, 'invalid_value', 'Paste the access token from your Shopify custom app.');
    }
    // One store, one subscriber: a domain already connected to a
    // DIFFERENT business is a conflict, never a silent share —
    // webhooks find their business by this domain.
    const clash = await pool().query(
      "SELECT business_id FROM pos_connections WHERE provider = 'shopify' AND LOWER(provider_account_id) = $1 AND status = 'connected' AND business_id <> $2 LIMIT 1",
      [domain, req.params.bid],
    );
    if (clash.rows[0]) {
      throw err(409, 'store_already_connected', 'That Shopify store is already connected to another workspace here. Disconnect it there first.');
    }
    let locationId = null;
    if (body.location_id) {
      const loc = await pool().query(
        'SELECT id FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1',
        [String(body.location_id), req.params.bid],
      );
      if (!loc.rows[0]) throw err(400, 'invalid_reference', 'That location is not in this business.');
      locationId = String(body.location_id);
    }
    const row = await upsertConnection(req.params.bid, 'shopify', {
      status: 'connected',
      label: String(body.label || '').trim() || domain,
      provider_account_id: domain,
      location_id: locationId,
      credentials: JSON.stringify({ access_token: token }),
      last_error: '',
    }, req.user);
    return res.status(201).json({ connection: publicConnection(row) });
  }));

  // ---- Disconnect / till location -------------------------------------------

  router.post(`${base}/connections/:provider/disconnect`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const provider = String(req.params.provider || '');
    if (!PROVIDERS.includes(provider)) throw err(404, 'not_found', 'Unknown provider.');
    const row = await upsertConnection(req.params.bid, provider, {
      status: 'not_connected', credentials: '', last_error: '',
    }, req.user);
    return res.json({ connection: publicConnection(row) });
  }));

  router.post(`${base}/connections/:provider/location`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const provider = String(req.params.provider || '');
    if (!PROVIDERS.includes(provider)) throw err(404, 'not_found', 'Unknown provider.');
    const locationId = String(req.body?.location_id || '');
    const loc = await pool().query(
      'SELECT id FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1',
      [locationId, req.params.bid],
    );
    if (!loc.rows[0]) throw err(400, 'invalid_reference', 'That location is not in this business.');
    const row = await upsertConnection(req.params.bid, provider, { location_id: locationId }, req.user);
    return res.json({ connection: publicConnection(row) });
  }));

  // ---- Mappings ---------------------------------------------------------------

  router.post(`${base}/mappings`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const body = req.body || {};
    const provider = String(body.provider || '');
    const itemKey = String(body.provider_item_key || '').trim();
    const productId = String(body.product_id || '');
    if (!['square', 'shopify', 'csv'].includes(provider) || !itemKey) {
      throw err(400, 'invalid_value', 'A mapping needs the provider and the item it came in as.');
    }
    const product = await pool().query(
      'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
      [productId, req.params.bid],
    );
    if (!product.rows[0]) throw err(400, 'invalid_reference', 'That product is not in this business.');
    const existing = await pool().query(
      'SELECT * FROM pos_item_mappings WHERE business_id = $1 AND provider = $2 AND provider_item_key = $3 LIMIT 1',
      [req.params.bid, provider, itemKey],
    );
    let mapping;
    if (existing.rows[0]) {
      const updated = await pool().query(
        'UPDATE pos_item_mappings SET product_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [productId, existing.rows[0].id],
      );
      mapping = updated.rows[0];
    } else {
      const inserted = await pool().query(
        `INSERT INTO pos_item_mappings (id, business_id, provider, provider_item_key, product_id, created_by_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [crypto.randomUUID(), req.params.bid, provider, itemKey, productId, req.user.id, req.user.email],
      );
      mapping = inserted.rows[0];
    }
    const held = await pool().query(
      `SELECT COUNT(*)::int AS n FROM pos_sale_lines l
         JOIN pos_sale_events e ON e.id = l.event_id
        WHERE l.business_id = $1 AND e.provider = $2 AND l.provider_item_key = $3
          AND l.status IN ('unmatched', 'insufficient_stock')`,
      [req.params.bid, provider, itemKey],
    );
    return res.status(201).json({ mapping, held_count: held.rows[0].n });
  }));

  router.post(`${base}/mappings/:id/apply-held`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req, { write: true });
    const { rows } = await pool().query(
      'SELECT * FROM pos_item_mappings WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const mapping = rows[0];
    if (!mapping) throw err(404, 'not_found', 'That mapping is not in this business.');
    const result = await retryHeldLines(pool(), {
      businessId: req.params.bid,
      provider: mapping.provider,
      providerItemKey: mapping.provider_item_key,
      planKey: access.planKey,
      caller: req.user,
    });
    return res.json({ mapping, ...result });
  }));

  // ---- Apply the sales held for the plan --------------------------------------
  // Sales recorded while the business was off Business (held_plan)
  // count from here once it is back: the same retry the mapping
  // screen uses, over every held line. This route only exists
  // behind the Business gate in ctx(), so a held sale can only be
  // applied while the plan includes till connections.

  router.post(`${base}/apply-held-plan`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req, { write: true });
    const result = await retryHeldLines(pool(), {
      businessId: req.params.bid,
      planKey: access.planKey,
      caller: req.user,
    });
    return res.json(result);
  }));

  // ---- CSV sales import ---------------------------------------------------------

  router.post(`${base}/csv-import`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req, { write: true });
    const body = req.body || {};
    let csvText = typeof body.csv === 'string' ? body.csv : '';
    if (!csvText && Array.isArray(body.rows)) {
      // Rows travel the exact same parser as raw text: quote every
      // cell and let parseSalesCsv validate + group them.
      const headers = ['sale_id', 'sold_at', 'sku_or_barcode', 'quantity', 'item_name', 'location'];
      const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = body.rows.map((row) => headers.map((h) => quote(row?.[h])).join(','));
      csvText = [headers.join(','), ...lines].join('\n');
    }
    if (!csvText.trim()) throw err(400, 'invalid_value', 'Choose the end-of-day CSV file from your till first.');
    const { sales, problems } = parseSalesCsv(csvText);
    const outcomes = [];
    for (const sale of sales) {
      const result = await applyPosSale(pool(), {
        businessId: req.params.bid,
        provider: 'csv',
        source: 'csv',
        sale,
        planKey: access.planKey,
        caller: req.user,
      });
      outcomes.push({
        external_sale_id: sale.externalSaleId,
        duplicate: result.duplicate,
        status: result.event.status,
      });
    }
    return res.json({
      imported: outcomes.filter((o) => !o.duplicate).length,
      duplicates: outcomes.filter((o) => o.duplicate).length,
      outcomes,
      problems,
    });
  }));

  return router;
}

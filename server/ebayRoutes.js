/**
 * Storefront routes — the eBay connection (release 362).
 *
 *   GET  /api/businesses/:bid/storefronts/overview        connection + readiness + recent eBay sales + sales that need matching + sweep state
 *   POST /api/businesses/:bid/storefronts/ebay/connect    OAuth start (or the plain not-configured answer)
 *   POST /api/businesses/:bid/storefronts/ebay/disconnect revoke + clear the connection (sales history stays)
 *   POST /api/businesses/:bid/storefronts/ebay/location   { location_id } — which location eBay sales deduct from
 *   POST /api/businesses/:bid/storefronts/ebay/check-now  run the catch-up sweep for this connection now
 *   POST /api/businesses/:bid/storefronts/mappings        { provider_item_key, product_id } — link a sold item to its product
 *   POST /api/businesses/:bid/storefronts/mappings/:id/apply-held  record the held sales for a saved link
 *
 * The owner's ruling (Nov 23, 2026): storefront connections
 * are BOTH PLANS. There is deliberately NO plan gate here —
 * the till router's Business gate (server/posRoutes.js) does
 * not extend to storefronts. What still gates, exactly as on
 * the till page: the grace rule on management writes, and
 * who manages — the owner or a manager; staff can look but
 * cannot connect, link or check.
 *
 * The sales themselves live in the shared POS tables under
 * provider 'ebay' (migration 049): the idempotency anchor,
 * the matching and the ledger are the core's, never a
 * parallel writer.
 *
 * CREDENTIALS: pos_connections.credentials is NEVER selected
 * into a response — publicConnection() (server/posRoutes.js)
 * is the whitelist, reused here unchanged.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { personLevel } from './workforceRoutes.js';
import { publicConnection } from './posRoutes.js';
import { publicEvent, retryHeldLines } from './posCore.js';
import {
  ebayConfig,
  ebayAuthorizeUrl,
  parseEbayCredentials,
  sweepEbayConnection,
} from './posEbay.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] Storefront route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createStorefrontRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/storefronts';

  async function ctx(req, { write = false } = {}) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    const level = access.isOwner ? 'owner' : personLevel(access.staffRow);
    if (write) {
      await assertNotInGrace(pool(), req.params.bid);
      if (level === 'staff') {
        throw err(403, 'forbidden', 'Storefront connections are managed by the owner or a manager.');
      }
    }
    return { access, level };
  }

  async function ebayConnection(businessId) {
    const { rows } = await pool().query(
      "SELECT * FROM pos_connections WHERE business_id = $1 AND provider = 'ebay' LIMIT 1",
      [businessId],
    );
    return rows[0] ?? null;
  }

  async function recentEvents(businessId, limit) {
    const { rows } = await pool().query(
      "SELECT * FROM pos_sale_events WHERE business_id = $1 AND provider = 'ebay' ORDER BY created_at DESC LIMIT $2",
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
        WHERE l.business_id = $1 AND e.provider = 'ebay' AND l.status IN ('unmatched', 'insufficient_stock')
        ORDER BY l.created_at DESC LIMIT 200`,
      [businessId],
    );
    return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
  }

  router.get(`${base}/overview`, asyncHandler(async (req, res) => {
    const { level } = await ctx(req);
    const connection = await ebayConnection(req.params.bid);
    let sweepState = null;
    if (connection) {
      const { rows } = await pool().query(
        'SELECT last_sweep_at, last_error FROM ebay_sweep_state WHERE connection_id = $1 LIMIT 1',
        [connection.id],
      );
      sweepState = rows[0] ?? null;
    }
    return res.json({
      configured: ebayConfig().oauthConfigured,
      level,
      // One card, one shape: a business that never connected
      // gets the plain not-connected card, not a null.
      connection: publicConnection(connection) ?? {
        provider: 'ebay',
        status: 'not_connected',
        label: '',
        provider_account_id: '',
        location_id: null,
        has_credentials: false,
        last_error: '',
      },
      events: await recentEvents(req.params.bid, 25),
      unmatched: await heldLines(req.params.bid),
      sweep_state: sweepState,
    });
  }));

  router.post(`${base}/ebay/connect`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const url = ebayAuthorizeUrl(req.params.bid);
    if (!url) {
      return res.json({
        provider: 'ebay',
        configured: false,
        message: 'eBay connections are not switched on yet — the app owner has not added the eBay keys.',
      });
    }
    return res.json({ provider: 'ebay', configured: true, authorize_url: url });
  }));

  router.post(`${base}/ebay/disconnect`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const connection = await ebayConnection(req.params.bid);
    if (connection) {
      // Revoke at eBay first (best effort — a failed revoke
      // never traps the owner in a connection they ended),
      // then discard the stored tokens. The recorded sales
      // stay: disconnecting ends the feed, not the history.
      const cfg = ebayConfig();
      const creds = parseEbayCredentials(connection);
      if (cfg.oauthConfigured && creds.refresh_token) {
        try {
          await fetch(`${cfg.environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'}/identity/v1/oauth2/revoke`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(`${cfg.appId}:${cfg.certId}`, 'utf8').toString('base64')}`,
            },
            body: new URLSearchParams({ token: creds['refresh_token'], token_type_hint: 'refresh_token' }).toString(),
          });
        } catch {
          // Best effort by design (see above).
        }
      }
      await pool().query(
        `UPDATE pos_connections
            SET status = 'not_connected', credentials = '', provider_account_id = '', label = '', last_error = '', updated_at = NOW()
          WHERE id = $1`,
        [connection.id],
      );
    }
    const fresh = await ebayConnection(req.params.bid);
    return res.json({ connection: publicConnection(fresh) });
  }));

  router.post(`${base}/ebay/location`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const connection = await ebayConnection(req.params.bid);
    if (!connection) throw err(404, 'not_found', 'There is no eBay connection in this business.');
    const locationId = String(req.body?.location_id || '') || null;
    if (locationId) {
      const { rows } = await pool().query(
        'SELECT id FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1',
        [locationId, req.params.bid],
      );
      if (!rows[0]) throw err(400, 'invalid_reference', 'That location is not in this business.');
    }
    await pool().query('UPDATE pos_connections SET location_id = $1, updated_at = NOW() WHERE id = $2', [
      locationId,
      connection.id,
    ]);
    const fresh = await ebayConnection(req.params.bid);
    return res.json({ connection: publicConnection(fresh) });
  }));

  router.post(`${base}/ebay/check-now`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const connection = await ebayConnection(req.params.bid);
    if (!connection || connection.status !== 'connected') {
      return res.json({ ran: false, reason: 'not_connected' });
    }
    const summary = await sweepEbayConnection(pool(), connection, {});
    return res.json({ ran: true, ...summary });
  }));

  router.post(`${base}/mappings`, asyncHandler(async (req, res) => {
    await ctx(req, { write: true });
    const body = req.body || {};
    const itemKey = String(body.provider_item_key || '').trim();
    const productId = String(body.product_id || '');
    if (!itemKey || !productId) {
      throw err(400, 'invalid_value', 'A mapping needs the item it came in as and the product it belongs to.');
    }
    const product = await pool().query(
      'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
      [productId, req.params.bid],
    );
    if (!product.rows[0]) throw err(400, 'invalid_reference', 'That product is not in this business.');
    const existing = await pool().query(
      "SELECT * FROM pos_item_mappings WHERE business_id = $1 AND provider = 'ebay' AND provider_item_key = $2 LIMIT 1",
      [req.params.bid, itemKey],
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
         VALUES ($1, $2, 'ebay', $3, $4, $5, $6) RETURNING *`,
        [crypto.randomUUID(), req.params.bid, itemKey, productId, req.user.id, req.user.email],
      );
      mapping = inserted.rows[0];
    }
    const held = await pool().query(
      `SELECT COUNT(*)::int AS n FROM pos_sale_lines l
         JOIN pos_sale_events e ON e.id = l.event_id
        WHERE l.business_id = $1 AND e.provider = 'ebay' AND l.provider_item_key = $2
          AND l.status IN ('unmatched', 'insufficient_stock')`,
      [req.params.bid, itemKey],
    );
    return res.status(201).json({ mapping, held_count: held.rows[0].n });
  }));

  router.post(`${base}/mappings/:id/apply-held`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req, { write: true });
    const { rows } = await pool().query(
      "SELECT * FROM pos_item_mappings WHERE id = $1 AND business_id = $2 AND provider = 'ebay' LIMIT 1",
      [req.params.id, req.params.bid],
    );
    const mapping = rows[0];
    if (!mapping) throw err(404, 'not_found', 'That mapping is not in this business.');
    const result = await retryHeldLines(pool(), {
      businessId: req.params.bid,
      provider: 'ebay',
      providerItemKey: mapping.provider_item_key,
      planKey: access.planKey,
      caller: req.user,
    });
    return res.json({ mapping, ...result });
  }));

  return router;
}

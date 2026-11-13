/**
 * Shopify POS adapter — POS phase. One of two adapters over the
 * shared core (server/posCore.js).
 *
 * Shopify POS sales ARE Shopify orders — there is no separate
 * POS feed, and none is invented here. A sale at the till arrives
 * as an orders/create webhook for the store.
 *
 * Connection is per-store, by the owner's own hand: the owner
 * pastes their store domain + the access token from their own
 * Shopify custom app. The token is stored server-side only (the
 * pos_connections.credentials column, excluded from every API
 * response — see server/posRoutes.js) and is used at go-live to
 * verify the store; this phase's stock movement is driven by the
 * webhook.
 *
 * Webhook verification is HMAC-SHA256 over the raw body with the
 * app's shared secret (SHOPIFY_API_SECRET, a Fly secret). Without
 * it the receiver answers 503 — fail closed, like Stripe's.
 * Unverified payloads are refused, never 200.
 */
import crypto from 'node:crypto';
import { getPool } from './db.js';
import { planFor } from './plans.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applyPosSale } from './posCore.js';

export function shopifyConfig() {
  const apiSecret = process.env.SHOPIFY_API_SECRET || '';
  return { apiSecret, webhookConfigured: Boolean(apiSecret) };
}

/** Shopify signs the raw body with HMAC-SHA256, base64-encoded. */
export function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!secret) return { ok: false, reason: 'webhook_secret_not_configured' };
  if (!hmacHeader) return { ok: false, reason: 'missing_signature' };
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(String(hmacHeader), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, reason: null };
}

/** Shopify order object → the shared normalized sale shape. */
export function normalizeShopifyOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const externalSaleId = String(order.id || '').trim();
  if (!externalSaleId) return null;
  const lines = (Array.isArray(order.line_items) ? order.line_items : []).map((item) => ({
    providerItemKey: item.variant_id ? `variant:${item.variant_id}` : String(item.sku || `line:${item.id || ''}`),
    itemLabel: String(item.name || item.title || ''),
    sku: String(item.sku || ''),
    barcode: '',
    quantity: Number(item.quantity) || 0,
  }));
  return {
    externalSaleId,
    soldAt: order.created_at || null,
    locationLabel: '',
    totalAmount: order.total_price != null && order.total_price !== '' ? Number(order.total_price) : null,
    totalCurrency: String(order.currency || ''),
    summary: `Shopify order ${order.name || externalSaleId}`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/shopify (express.raw, raw body kept).
// ---------------------------------------------------------------------------

export async function shopifyWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const cfg = shopifyConfig();
  if (!cfg.webhookConfigured) {
    return res.status(503).json({ error: 'pos_not_configured', message: 'The Shopify webhook is not configured yet.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const check = verifyShopifyHmac(rawBody, req.get('x-shopify-hmac-sha256'), cfg.apiSecret);
  if (!check.ok) {
    console.error(`[twin] Shopify webhook rejected (${check.reason}) — never 200 for an unverified event.`);
    return res.status(400).json({ error: 'invalid_signature', reason: check.reason });
  }
  const topic = String(req.get('x-shopify-topic') || '');
  if (topic !== 'orders/create') {
    return res.json({ received: true, recorded: false, reason: 'only orders/create moves stock' });
  }
  let order;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  const sale = normalizeShopifyOrder(order);
  if (!sale) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The order has no id.' });
  }
  const shopDomain = String(req.get('x-shopify-shop-domain') || '').trim().toLowerCase();
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'shopify' AND LOWER(provider_account_id) = $1 AND status = 'connected' LIMIT 1",
    [shopDomain],
  );
  const connection = rows[0];
  if (!connection) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No connected business matches this Shopify store.' });
  }
  // Plan gate (owner's ruling, Nov 13, 2026): till connections are
  // Business only. A sale that arrives while the business is off
  // Business is still ACCEPTED (2xx — no provider retry storm) and
  // recorded HELD FOR PLAN: never lost, never applied, until the
  // business is on Business again and applies it from the app.
  const planKey = await planFor(pool, connection.business_id);
  // Subscription gate (2026-11-13): hold, never apply, when the
  // workspace's subscription is not currently access-granting.
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  let result;
  try {
    result = await applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'shopify',
    source: 'webhook',
    sale,
    planKey,
      holdForPlan: planKey !== 'business' || !entitled,
    });
  } catch {
    // Answer 500 so the provider retries later; hanging (an
    // unhandled throw) would stall the delivery and tell us nothing.
    return res.status(500).json({ error: 'pos_webhook_error' });
  }
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

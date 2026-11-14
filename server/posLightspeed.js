/**
 * Lightspeed Retail (X-Series) adapter — POS provider expansion
 * (Nov 14, 2026). One of the adapters over the shared core
 * (server/posCore.js).
 *
 * Built to Lightspeed's documented X-Series API shape
 * (x-series-api.lightspeedhq.com):
 *   - Connect is per-store, by the owner's own hand: the store's
 *     domain prefix (the {prefix} in {prefix}.retail.lightspeed.app)
 *     plus an API token for that retailer (an OAuth app's token or
 *     a retailer-generated API token — both are documented X-Series
 *     credential forms). Stored server-side only.
 *   - Sales arrive as `sale.update` webhooks whose payload IS the
 *     sale object (API 1.0 shape): id, register_id, sale_date,
 *     total_price, status, and register_sale_products[] carrying
 *     product_id, name and quantity (the SKU lives on the product,
 *     not the sale line, so the durable match key is the product
 *     id — the mapping screen covers stores until then).
 *   - A sale.update fires on EVERY change (parked, saved, layby…)
 *     and the shared core's idempotency keys on the sale id — so
 *     only a CLOSED sale (fully paid) records here. An earlier
 *     parked copy must never consume the id: the closed delivery
 *     is the one that counts.
 *   - Delivery authenticity: header `X-Signature:
 *     signature=<sig>,algorithm=HMAC-SHA256` — HMAC-SHA256 over
 *     the raw body keyed with the client secret of the app that
 *     registered the webhook. That secret is per-connection when
 *     the owner pastes it on the card (their own Lightspeed app),
 *     else the platform LIGHTSPEED_CLIENT_SECRET. Neither set →
 *     503, fail closed; a mismatch → 400.
 *   - Routing: webhooks are registered PER RETAILER with a
 *     target URL of the retailer's choosing, so the destination
 *     carries the store's domain prefix:
 *     /webhooks/pos/lightspeed/<domain_prefix> — the card shows
 *     the exact URL to register. That is how the delivery finds
 *     its connection; the signature still has to pass.
 */
import crypto from 'node:crypto';
import { getPool } from './db.js';
import { planFor } from './plans.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applyPosSale } from './posCore.js';

export function lightspeedConfig() {
  const clientSecret = process.env.LIGHTSPEED_CLIENT_SECRET || '';
  return { clientSecret, webhookConfigured: Boolean(clientSecret) };
}

function credentialsOf(connection) {
  try { return JSON.parse(connection?.credentials || '{}'); } catch { return {}; }
}

/** The secret a delivery for this connection must be signed with. */
export function lightspeedSecretFor(connection) {
  const own = String(credentialsOf(connection).webhook_secret || '');
  return own || lightspeedConfig().clientSecret || '';
}

/**
 * Verify an X-Signature delivery. The documented digest has been
 * seen both hex- and base64-encoded across Lightspeed's surfaces,
 * so either encoding of the same HMAC is accepted — the key and
 * the signed bytes are exactly the documented ones either way.
 */
export function verifyLightspeedSignature(rawBody, header, secret) {
  if (!secret) return { ok: false, reason: 'webhook_secret_not_configured' };
  if (!header) return { ok: false, reason: 'missing_signature' };
  const match = /signature=([^,]+)/i.exec(String(header));
  const provided = (match ? match[1] : String(header)).trim();
  if (!provided) return { ok: false, reason: 'missing_signature' };
  const candidates = [
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'),
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64'),
  ];
  const a = Buffer.from(provided, 'utf8');
  const ok = candidates.some((candidate) => {
    const b = Buffer.from(candidate, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  return ok ? { ok: true, reason: null } : { ok: false, reason: 'bad_signature' };
}

/** Lightspeed sale object (API 1.0 webhook shape) → normalized sale. */
export function normalizeLightspeedSale(sale) {
  if (!sale || typeof sale !== 'object') return null;
  const externalSaleId = String(sale.id || '').trim();
  if (!externalSaleId) return null;
  const products = Array.isArray(sale.register_sale_products) ? sale.register_sale_products : [];
  const lines = products.map((p) => ({
    providerItemKey: p?.product_id ? `product:${p.product_id}` : `line:${p?.id || ''}`,
    itemLabel: String(p?.name || ''),
    sku: '',
    barcode: '',
    quantity: Number(p?.quantity) || 0,
  }));
  return {
    externalSaleId,
    soldAt: sale.sale_date || sale.created_at || null,
    locationLabel: '',
    totalAmount: sale.total_price != null && sale.total_price !== '' ? Number(sale.total_price) : null,
    totalCurrency: '',
    summary: `Lightspeed sale ${externalSaleId}`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/lightspeed/:storeKey (express.raw).
// :storeKey is the store's Lightspeed domain prefix, exactly as
// the owner registered the destination URL in Lightspeed.
// ---------------------------------------------------------------------------

export async function lightspeedWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const storeKey = String(req.params?.storeKey || '').trim().toLowerCase();
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'lightspeed' AND LOWER(provider_account_id) = $1 AND status = 'connected' LIMIT 1",
    [storeKey],
  );
  const connection = rows[0];
  if (!connection) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No connected business matches this Lightspeed store.' });
  }
  const secret = lightspeedSecretFor(connection);
  if (!secret) {
    return res.status(503).json({ error: 'pos_not_configured', message: 'The Lightspeed webhook is not configured yet.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const check = verifyLightspeedSignature(rawBody, req.get('x-signature'), secret);
  if (!check.ok) {
    console.error(`[twin] Lightspeed webhook rejected (${check.reason}) — never 200 for an unverified event.`);
    return res.status(400).json({ error: 'invalid_signature', reason: check.reason });
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  const saleObject = payload?.sale && typeof payload.sale === 'object' ? payload.sale : payload;
  // Only a CLOSED sale is a completed till sale (see the header
  // note): parked/saved/layby updates are acknowledged, and the
  // later CLOSED delivery for the same sale id is the one that
  // records — exactly once, by the core's idempotency.
  if (String(saleObject?.status || '').toUpperCase() !== 'CLOSED') {
    return res.json({ received: true, recorded: false, reason: 'sale is not closed yet' });
  }
  const sale = normalizeLightspeedSale(saleObject);
  if (!sale) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The sale has no id.' });
  }
  const planKey = await planFor(pool, connection.business_id);
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  const result = await applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'lightspeed',
    source: 'webhook',
    sale,
    planKey,
    // Plan gate (owner's ruling, Nov 13, 2026): held, never lost,
    // never applied while off Business / unentitled.
    holdForPlan: planKey !== 'business' || !entitled,
  });
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

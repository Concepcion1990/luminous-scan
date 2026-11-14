/**
 * PayPal Zettle adapter — POS provider expansion (Nov 14, 2026).
 * One of the adapters over the shared core (server/posCore.js).
 *
 * Built to Zettle's documented Pusher API (developer.zettle.com;
 * the subscription + verification guide):
 *   - A subscription is created per organization —
 *     POST https://pusher.zettle.com/organizations/self/subscriptions
 *     { uuid, transportName: "WEBHOOK", eventNames:
 *     ["PurchaseCreated"], destination, contactEmail } with the
 *     merchant's own Zettle API credentials — and the response
 *     carries a `signingKey`. Connect here is therefore the
 *     owner's own hand, like Shopify's: paste the organization
 *     UUID + that signing key. Both are stored server-side only;
 *     the key is never rendered back.
 *   - Deliveries POST an envelope { organizationUuid,
 *     messageUuid, eventName: "PurchaseCreated", messageId,
 *     payload: "<the purchase, as a JSON string>", timestamp }.
 *     The purchase carries purchaseUuid, amount in minor units,
 *     currency, a millisecond timestamp, and products[] with
 *     productUuid / variantUuid, name, sku, barcode and a STRING
 *     quantity.
 *   - Delivery authenticity, exactly as documented: header
 *     `X-iZettle-Signature` = hex HMAC-SHA256 over
 *     "<timestamp>.<payload>" keyed with the subscription's
 *     signing key. A mismatch is refused 400 — never 200 for an
 *     unverified event.
 *
 * External step remaining: the merchant (guided at go-live)
 * creates the Pusher subscription with their own Zettle API key
 * and pastes the returned signing key here. Creating that
 * subscription from inside this app would need the merchant's
 * Zettle OAuth grant — deliberately not faked.
 */
import crypto from 'node:crypto';
import { getPool } from './db.js';
import { planFor } from './plans.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applyPosSale } from './posCore.js';

function credentialsOf(connection) {
  try { return JSON.parse(connection?.credentials || '{}'); } catch { return {}; }
}

/**
 * Zettle's documented verification: HMAC-SHA256 hex over
 * "<timestamp>.<payload>" — timestamp and payload are the
 * envelope's own fields, the payload in its delivered (string)
 * form.
 */
export function verifyZettleSignature(envelope, signatureHeader, signingKey) {
  if (!signingKey) return { ok: false, reason: 'signing_key_not_configured' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  const payloadText = typeof envelope?.payload === 'string'
    ? envelope.payload
    : JSON.stringify(envelope?.payload ?? '');
  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${envelope?.timestamp ?? ''}.${payloadText}`, 'utf8')
    .digest('hex');
  const a = Buffer.from(String(signatureHeader), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, reason: null };
}

/** Zettle purchase object → the shared normalized sale shape. Amounts are minor units. */
export function normalizeZettlePurchase(purchase) {
  if (!purchase || typeof purchase !== 'object') return null;
  const externalSaleId = String(purchase.purchaseUuid || purchase.purchaseUUID || '').trim();
  if (!externalSaleId) return null;
  const lines = (Array.isArray(purchase.products) ? purchase.products : [])
    .filter((p) => p && (p.productUuid || p.variantUuid))
    .map((p) => ({
      providerItemKey: p.variantUuid ? `variant:${p.variantUuid}` : `product:${p.productUuid}`,
      itemLabel: [p.name, p.variantName].filter(Boolean).join(' — '),
      sku: String(p.sku || ''),
      barcode: String(p.barcode || ''),
      // Zettle reports quantity as a string ("2") in its payloads.
      quantity: Number(p.quantity) || 0,
    }));
  const soldAt = purchase.timestamp
    ? new Date(Number(purchase.timestamp)).toISOString()
    : purchase.created || null;
  return {
    externalSaleId,
    soldAt,
    locationLabel: '',
    totalAmount: purchase.amount != null && purchase.amount !== '' ? Number(purchase.amount) / 100 : null,
    totalCurrency: String(purchase.currency || ''),
    summary: `Zettle purchase ${purchase.purchaseNumber || externalSaleId}`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/zettle (express.raw, raw body kept).
// ---------------------------------------------------------------------------

export async function zettleWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  let envelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  if (String(envelope?.eventName || '') !== 'PurchaseCreated') {
    // Includes the subscription's own TestMessage ping.
    return res.json({ received: true, recorded: false, reason: 'not a purchase event' });
  }
  const organizationUuid = String(envelope?.organizationUuid || '');
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'zettle' AND provider_account_id = $1 AND status = 'connected' LIMIT 1",
    [organizationUuid],
  );
  const connection = rows[0];
  if (!connection) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No connected business matches this Zettle organization.' });
  }
  const signingKey = String(credentialsOf(connection).signing_key || '');
  if (!signingKey) {
    return res.status(503).json({ error: 'pos_not_configured', message: 'This Zettle connection has no signing key stored — reconnect Zettle.' });
  }
  const check = verifyZettleSignature(envelope, req.get('x-izettle-signature'), signingKey);
  if (!check.ok) {
    console.error(`[twin] Zettle webhook rejected (${check.reason}) — never 200 for an unverified event.`);
    return res.status(400).json({ error: 'invalid_signature', reason: check.reason });
  }
  let purchase = envelope.payload;
  if (typeof purchase === 'string') {
    try { purchase = JSON.parse(purchase); } catch { purchase = null; }
  }
  const sale = normalizeZettlePurchase(purchase);
  if (!sale) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The purchase has no purchase uuid.' });
  }
  const planKey = await planFor(pool, connection.business_id);
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  const result = await applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'zettle',
    source: 'webhook',
    sale,
    planKey,
    // Plan gate (owner's ruling, Nov 13, 2026): held, never lost,
    // never applied while off Business / unentitled.
    holdForPlan: planKey !== 'business' || !entitled,
  });
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

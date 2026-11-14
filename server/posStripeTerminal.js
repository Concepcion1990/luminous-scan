/**
 * Stripe Terminal adapter — POS provider expansion (Nov 14,
 * 2026). One of the adapters over the shared core
 * (server/posCore.js).
 *
 * Stripe Terminal is Stripe-native: the till runs on the
 * SUBSCRIBER'S OWN Stripe account, so there is no platform app
 * and no platform secret. Connect is per-store, by the owner's
 * own hand, exactly like Shopify's: they register this app's
 * webhook endpoint in their own Stripe dashboard, then paste
 * their Stripe account id (acct_…) and that endpoint's signing
 * secret (whsec_…). The secret is stored server-side only and
 * verifies THEIR deliveries with Stripe's standard scheme:
 * header `Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of
 * "<t>.<raw body>">`, with the usual 5-minute tolerance.
 *
 * THE HONEST LIMIT, stated in code rather than dressed up:
 * Stripe charges carry NO line-item breakdown — a Terminal
 * charge knows its amount, not what was sold. Item detail can
 * only come from the charge's metadata, so this adapter defines
 * exactly one documented contract for tills that stamp it:
 * metadata key `stockhaven_items`, a JSON array of
 * { "sku": "...", "quantity": n, "name": "..." }. A charge with
 * that metadata records its lines like any other till sale. A
 * charge WITHOUT it is acknowledged and NOT recorded —
 * inventing items for a total-only charge would corrupt stock —
 * and the card + lesson point the owner at the CSV end-of-day
 * import, which stays the itemized path for a plain Terminal
 * setup.
 *
 * Multi-tenant verification: each subscriber's endpoint secret
 * is different, so the receiver tries the connected
 * stripe_terminal connections' secrets until one verifies (and,
 * when the event names an account, only that account's secret
 * is tried for it). No match → 400, never 200.
 */
import crypto from 'node:crypto';
import { getPool } from './db.js';
import { planFor } from './plans.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applyPosSale } from './posCore.js';

function credentialsOf(connection) {
  try { return JSON.parse(connection?.credentials || '{}'); } catch { return {}; }
}

const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Stripe's standard webhook signature check (per-endpoint secret). */
export function verifyStripeSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return { ok: false, reason: 'webhook_secret_not_configured' };
  if (!header) return { ok: false, reason: 'missing_signature' };
  let timestamp = '';
  const signatures = [];
  for (const part of String(header).split(',')) {
    const [key, value] = part.split('=').map((s) => (s || '').trim());
    if (key === 't') timestamp = value || '';
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!timestamp || !signatures.length) return { ok: false, reason: 'malformed_signature_header' };
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const b = Buffer.from(expected, 'utf8');
  const ok = signatures.some((signature) => {
    const a = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  return ok ? { ok: true, reason: null } : { ok: false, reason: 'bad_signature' };
}

/**
 * Stripe charge object → the shared normalized sale shape, or
 * null when the charge carries no item detail (see the header
 * note: a total-only charge is never dressed up as a sale with
 * invented items).
 */
export function normalizeStripeTerminalCharge(charge) {
  if (!charge || typeof charge !== 'object') return null;
  const externalSaleId = String(charge.id || '').trim();
  if (!externalSaleId) return null;
  let items = null;
  const rawItems = charge.metadata?.stockhaven_items;
  if (typeof rawItems === 'string' && rawItems.trim()) {
    try {
      const parsed = JSON.parse(rawItems);
      if (Array.isArray(parsed)) items = parsed;
    } catch { items = null; }
  }
  if (!items || !items.length) return null;
  const lines = items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      providerItemKey: String(item.sku || item.name || 'charge-item'),
      itemLabel: String(item.name || item.sku || ''),
      sku: String(item.sku || ''),
      barcode: String(item.barcode || ''),
      quantity: Number(item.quantity) || 0,
    }));
  if (!lines.length) return null;
  return {
    externalSaleId,
    soldAt: charge.created ? new Date(Number(charge.created) * 1000).toISOString() : null,
    locationLabel: '',
    totalAmount: charge.amount != null && charge.amount !== '' ? Number(charge.amount) / 100 : null,
    totalCurrency: String(charge.currency || '').toUpperCase(),
    summary: `Stripe Terminal charge ${externalSaleId}`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/stripe-terminal (express.raw).
// ---------------------------------------------------------------------------

export async function stripeTerminalWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'stripe_terminal' AND status = 'connected'",
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No Stripe Terminal connection exists yet.' });
  }
  // Find the connection whose endpoint secret verifies this
  // delivery. When the event names its account (Connect-shaped
  // events), only that account's connection is a candidate.
  const eventAccount = String(event?.account || '');
  let connection = null;
  for (const candidate of rows) {
    if (eventAccount && candidate.provider_account_id !== eventAccount) continue;
    const secret = String(credentialsOf(candidate).webhook_secret || '');
    if (!secret) continue;
    const check = verifyStripeSignature(rawBody, req.get('stripe-signature'), secret);
    if (check.ok) { connection = candidate; break; }
  }
  if (!connection) {
    console.error('[twin] Stripe Terminal webhook rejected (no connection secret verified it) — never 200 for an unverified event.');
    return res.status(400).json({ error: 'invalid_signature', reason: 'bad_signature' });
  }
  if (String(event?.type || '') !== 'charge.succeeded') {
    return res.json({ received: true, recorded: false, reason: 'only charge.succeeded moves stock' });
  }
  const charge = event?.data?.object || {};
  // A Terminal charge is an in-person payment; a plain online
  // charge on the same account is not a till sale.
  if (charge?.payment_method_details && charge.payment_method_details.type !== 'card_present'
    && charge.payment_method_details.type !== 'interac_present') {
    return res.json({ received: true, recorded: false, reason: 'not a Terminal (card-present) charge' });
  }
  const sale = normalizeStripeTerminalCharge(charge);
  if (!sale) {
    return res.json({
      received: true,
      recorded: false,
      reason: 'charge carries no item detail (no stockhaven_items metadata) — nothing truthful to count',
    });
  }
  const planKey = await planFor(pool, connection.business_id);
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  const result = await applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'stripe_terminal',
    source: 'webhook',
    sale,
    planKey,
    // Plan gate (owner's ruling, Nov 13, 2026): held, never lost,
    // never applied while off Business / unentitled.
    holdForPlan: planKey !== 'business' || !entitled,
  });
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

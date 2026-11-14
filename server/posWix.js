/**
 * Wix adapter — POS provider expansion (Nov 14, 2026). One of
 * the adapters over the shared core (server/posCore.js).
 *
 * What Wix actually documents (dev.wix.com), stated plainly:
 * Wix has NO public POS-specific sales feed. A sale rung up on
 * Wix POS lands in the same place as every other Wix sale — it
 * is a Wix eCommerce order, marked channelInfo.type "POS" — so
 * this adapter consumes the documented Wix eCommerce order
 * webhooks (wix.ecom.v1.order_created / order_approved /
 * order_updated) and records an order once it is PAID. Online
 * orders from the same Wix store flow through the same feed and
 * count too — they are the same store's stock; the channel rides
 * in the sale summary so the till sales list stays truthful.
 *
 * Delivery authenticity is Wix's own scheme, unlike every other
 * provider here: the ENTIRE request body is an RS256-signed JWT.
 * Verification uses the app's public key (the PEM from the app
 * dashboard → Webhooks → "Get Public Key"), held as the
 * platform-level WIX_PUBLIC_KEY Fly secret. Without it the
 * receiver answers 503 — fail closed; a token that does not
 * verify is refused 400. The decoded JWT's `data` is a JSON
 * string naming the eventType + instanceId; its own `data` is
 * another JSON string carrying { createdEvent: { entity:
 * <order> } }. The instanceId finds the connection (the owner
 * pastes it from their Wix dashboard on connect).
 *
 * External step remaining: the platform Wix app must exist in
 * Wix Studio with the order webhooks subscribed — there is no
 * third-party partner door beyond that app, which is exactly
 * why the CSV fallback stays on the same page for Wix stores.
 */
import crypto from 'node:crypto';
import { getPool } from './db.js';
import { planFor } from './plans.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applyPosSale } from './posCore.js';

export function wixConfig() {
  // PEMs pasted into a secrets dashboard commonly arrive with
  // literal \n escapes instead of newlines — accept both forms.
  const publicKey = String(process.env.WIX_PUBLIC_KEY || '').replace(/\\n/g, '\n');
  return { publicKey, webhookConfigured: Boolean(publicKey.trim()) };
}

function base64UrlToBuffer(text) {
  return Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify a Wix webhook JWT (RS256) and return its decoded
 * payload, or null. Manual verification with node:crypto — Wix
 * publishes no JWKS endpoint; the app public key is the trust
 * root, per Wix's own webhook documentation.
 */
export function verifyWixJwt(token, publicKeyPem) {
  if (!publicKeyPem) return null;
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlToBuffer(headerPart).toString('utf8'));
    payload = JSON.parse(base64UrlToBuffer(payloadPart).toString('utf8'));
  } catch {
    return null;
  }
  if (header?.alg !== 'RS256') return null;
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerPart}.${payloadPart}`, 'utf8');
    verifier.end();
    if (!verifier.verify(publicKeyPem, base64UrlToBuffer(signaturePart))) return null;
  } catch {
    return null;
  }
  if (payload?.exp && Number(payload.exp) * 1000 < Date.now()) return null;
  return payload;
}

/** Unwrap the two nested JSON-string layers of a Wix webhook envelope. */
export function unwrapWixEvent(jwtPayload) {
  let envelope = jwtPayload?.data;
  if (typeof envelope === 'string') {
    try { envelope = JSON.parse(envelope); } catch { return null; }
  }
  if (!envelope || typeof envelope !== 'object') return null;
  let inner = envelope.data;
  if (typeof inner === 'string') {
    try { inner = JSON.parse(inner); } catch { return null; }
  }
  const eventHolder = inner?.createdEvent || inner?.approvedEvent || inner?.updatedEvent || null;
  const order = eventHolder?.entity || null;
  if (!order) return null;
  return {
    eventType: String(envelope.eventType || ''),
    instanceId: String(envelope.instanceId || ''),
    order,
  };
}

/** Wix eCommerce order object → the shared normalized sale shape. */
export function normalizeWixOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const externalSaleId = String(order.id || '').trim();
  if (!externalSaleId) return null;
  const lines = (Array.isArray(order.lineItems) ? order.lineItems : []).map((item) => {
    const catalogId = item?.catalogReference?.catalogItemId;
    const name = typeof item?.productName === 'object'
      ? String(item.productName.original || '')
      : String(item?.productName || item?.name || '');
    return {
      providerItemKey: catalogId ? `item:${catalogId}` : String(item?.sku || `line:${item?.id || ''}`),
      itemLabel: name,
      sku: String(item?.sku || ''),
      barcode: '',
      quantity: Number(item?.quantity) || 0,
    };
  });
  const total = order.priceSummary?.totalPrice || order.priceSummary?.total || null;
  const channel = String(order.channelInfo?.type || '');
  return {
    externalSaleId,
    soldAt: order.createdDate || order._createdDate || null,
    locationLabel: '',
    totalAmount: total?.amount != null && total.amount !== '' ? Number(total.amount) : null,
    totalCurrency: String(total?.currency || order.currency || ''),
    summary: `Wix order ${order.number || externalSaleId}${channel ? ` (${channel})` : ''}`,
    lines,
  };
}

const ORDER_EVENT_TYPES = new Set([
  'wix.ecom.v1.order_created',
  'wix.ecom.v1.order_approved',
  'wix.ecom.v1.order_updated',
]);

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/wix (express.raw; the body IS a JWT).
// ---------------------------------------------------------------------------

export async function wixWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const cfg = wixConfig();
  if (!cfg.webhookConfigured) {
    return res.status(503).json({ error: 'pos_not_configured', message: 'The Wix webhook is not configured yet.' });
  }
  const rawBody = (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '')).trim();
  const jwtPayload = verifyWixJwt(rawBody, cfg.publicKey);
  if (!jwtPayload) {
    console.error('[twin] Wix webhook rejected (JWT did not verify) — never 200 for an unverified event.');
    return res.status(400).json({ error: 'invalid_signature', reason: 'bad_jwt' });
  }
  const unwrapped = unwrapWixEvent(jwtPayload);
  if (!unwrapped) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The webhook carries no order.' });
  }
  if (!ORDER_EVENT_TYPES.has(unwrapped.eventType)) {
    return res.json({ received: true, recorded: false, reason: 'not an order event' });
  }
  // Only a PAID order is a completed sale. order_created often
  // precedes payment; the paid delivery (created already paid,
  // or the later approved/updated one) is the one that records —
  // exactly once, by the core's idempotency.
  const paymentStatus = String(unwrapped.order?.paymentStatus || '').toUpperCase();
  if (paymentStatus !== 'PAID' && paymentStatus !== 'FULLY_PAID') {
    return res.json({ received: true, recorded: false, reason: 'order is not paid yet' });
  }
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'wix' AND provider_account_id = $1 AND status = 'connected' LIMIT 1",
    [unwrapped.instanceId],
  );
  const connection = rows[0];
  if (!connection) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No connected business matches this Wix site.' });
  }
  const sale = normalizeWixOrder(unwrapped.order);
  if (!sale) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The order has no id.' });
  }
  const planKey = await planFor(pool, connection.business_id);
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  const result = await applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'wix',
    source: 'webhook',
    sale,
    planKey,
    // Plan gate (owner's ruling, Nov 13, 2026): held, never lost,
    // never applied while off Business / unentitled.
    holdForPlan: planKey !== 'business' || !entitled,
  });
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

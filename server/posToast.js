/**
 * Toast adapter — POS provider expansion (Nov 14, 2026). One of
 * the adapters over the shared core (server/posCore.js).
 *
 * PARTNER-GATED, and this file says so plainly: Toast issues API
 * credentials only to vendors accepted into the Toast Partner
 * Program (application → vetting → signed partner agreement →
 * sandbox credentials → certification). There is no self-serve
 * door. What is built here is the COMPLETE in-app side, to
 * Toast's documented public API shape (doc.toasttab.com), so the
 * connection activates the moment partner approval + real
 * credentials exist:
 *   - Connect is per-restaurant credential paste: the client id +
 *     client secret the partner program issues, plus the
 *     restaurant GUID the restaurant authorizes. Stored
 *     server-side only, never rendered back.
 *   - Order webhooks carry only identifiers (eventCategory
 *     "order_updated", restaurantGuid, orderGuid), so the
 *     adapter fetches the order from the Orders API:
 *     POST {api}/authentication/v1/authentication/login
 *     { clientId, clientSecret, userAccessType:
 *     "TOAST_MACHINE_CLIENT" } → token, then
 *     GET {api}/orders/v2/orders/{guid} with the
 *     Toast-Restaurant-External-ID header.
 *   - Delivery authenticity: header `Toast-Signature` = Base64
 *     HMAC-SHA256 over (raw body + the payload's timestamp),
 *     keyed with the per-subscription signing secret issued in
 *     the Toast developer portal (TOAST_WEBHOOK_SECRET, a Fly
 *     secret). Without it the receiver answers 503; a mismatch
 *     is refused 400 — never 200 for an unverified event.
 *
 * Until partner approval lands, Toast users are covered by the
 * CSV end-of-day import, which stays on the same page.
 */
import crypto from 'node:crypto';
import { getPool } from './db.js';
import { planFor } from './plans.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applyPosSale } from './posCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function toastConfig() {
  const webhookSecret = process.env.TOAST_WEBHOOK_SECRET || '';
  return {
    webhookSecret,
    apiBase: (process.env.TOAST_API_BASE || 'https://ws-api.toasttab.com').replace(/\/+$/, ''),
    webhookConfigured: Boolean(webhookSecret),
  };
}

/** Toast signs Base64(HMAC-SHA256(secret, raw body + timestamp)). */
export function verifyToastSignature(rawBody, signatureHeader, secret, timestamp) {
  if (!secret) return { ok: false, reason: 'webhook_secret_not_configured' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${rawBody}${timestamp ?? ''}`, 'utf8')
    .digest('base64');
  const a = Buffer.from(String(signatureHeader), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, reason: null };
}

function credentialsOf(connection) {
  try { return JSON.parse(connection?.credentials || '{}'); } catch { return {}; }
}

// Client-credentials tokens are cached per restaurant for most of
// their documented lifetime so a busy till does not log in per
// sale. Process-local by design (a restart simply logs in again).
const tokenCache = new Map();

export async function toastAccessToken(connection, fetchImpl = fetch) {
  const cfg = toastConfig();
  const credentials = credentialsOf(connection);
  const restaurantGuid = String(connection?.provider_account_id || '');
  if (!credentials.client_id || !credentials.client_secret || !restaurantGuid) {
    throw err(409, 'toast_credentials_missing', 'This Toast connection is missing its credentials — reconnect Toast.');
  }
  const cached = tokenCache.get(restaurantGuid);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const res = await fetchImpl(`${cfg.apiBase}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });
  const data = await res.json().catch(() => ({}));
  const token = data?.token?.accessToken || '';
  if (!res.ok || !token) {
    throw err(502, 'toast_login_failed', 'Toast did not issue an access token for this connection.');
  }
  const expiresInSec = Number(data?.token?.expiresIn) || 3600;
  tokenCache.set(restaurantGuid, {
    token,
    expiresAt: Date.now() + Math.floor(expiresInSec * 0.8) * 1000,
  });
  return token;
}

/** Fetch one order from the Toast Orders API for this restaurant. */
export async function fetchToastOrder(connection, orderGuid, fetchImpl = fetch) {
  const cfg = toastConfig();
  const token = await toastAccessToken(connection, fetchImpl);
  const res = await fetchImpl(`${cfg.apiBase}/orders/v2/orders/${encodeURIComponent(orderGuid)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': String(connection.provider_account_id || ''),
      Accept: 'application/json',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.guid) {
    throw err(502, 'toast_order_fetch_failed', 'Toast did not return that order.');
  }
  return data;
}

/** Toast order object → the shared normalized sale shape. */
export function normalizeToastOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const externalSaleId = String(order.guid || '').trim();
  if (!externalSaleId) return null;
  const lines = [];
  let total = null;
  for (const check of Array.isArray(order.checks) ? order.checks : []) {
    if (!check || check.voidedDate || check.deleted) continue;
    const checkTotal = check.totalAmount != null ? Number(check.totalAmount)
      : check.amount != null ? Number(check.amount) : null;
    if (checkTotal != null && Number.isFinite(checkTotal)) {
      total = (total ?? 0) + checkTotal;
    }
    for (const selection of Array.isArray(check.selections) ? check.selections : []) {
      if (!selection || selection.voidedDate || selection.deleted) continue;
      lines.push({
        providerItemKey: selection.item?.guid ? `item:${selection.item.guid}` : `selection:${selection.guid || ''}`,
        itemLabel: String(selection.displayName || ''),
        sku: String(selection.plu || ''),
        barcode: '',
        quantity: Number(selection.quantity) || 0,
      });
    }
  }
  return {
    externalSaleId,
    soldAt: order.createdDate || order.openedDate || null,
    locationLabel: '',
    totalAmount: total,
    totalCurrency: '',
    summary: `Toast order ${externalSaleId}`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/toast (express.raw, raw body kept).
// ---------------------------------------------------------------------------

export async function toastWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const cfg = toastConfig();
  if (!cfg.webhookConfigured) {
    return res.status(503).json({ error: 'pos_not_configured', message: 'The Toast webhook is not configured yet.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  // Toast's signed content includes the payload's own timestamp,
  // so the signature can only be checked after this minimal parse;
  // nothing is recorded before it passes.
  const check = verifyToastSignature(rawBody, req.get('toast-signature'), cfg.webhookSecret, payload?.timestamp);
  if (!check.ok) {
    console.error(`[twin] Toast webhook rejected (${check.reason}) — never 200 for an unverified event.`);
    return res.status(400).json({ error: 'invalid_signature', reason: check.reason });
  }
  if (String(payload?.eventCategory || '') !== 'order_updated') {
    return res.json({ received: true, recorded: false, reason: 'not an order event' });
  }
  const restaurantGuid = String(payload?.restaurantGuid || req.get('toast-restaurant-external-id') || '');
  const orderGuid = String(payload?.orderGuid || '');
  if (!orderGuid) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The event has no order guid.' });
  }
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'toast' AND provider_account_id = $1 AND status = 'connected' LIMIT 1",
    [restaurantGuid],
  );
  const connection = rows[0];
  if (!connection) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No connected business matches this Toast restaurant.' });
  }
  let sale;
  try {
    const order = await fetchToastOrder(connection, orderGuid);
    sale = normalizeToastOrder(order);
  } catch (error) {
    console.error('[twin] Toast order fetch failed:', error?.message || error);
    return res.status(500).json({ error: 'pos_webhook_error' });
  }
  if (!sale) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The order has no guid.' });
  }
  const planKey = await planFor(pool, connection.business_id);
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  const result = await applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'toast',
    source: 'webhook',
    sale,
    planKey,
    // Plan gate (owner's ruling, Nov 13, 2026): held, never lost,
    // never applied while off Business / unentitled.
    holdForPlan: planKey !== 'business' || !entitled,
  });
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

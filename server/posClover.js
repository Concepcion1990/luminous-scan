/**
 * Clover adapter — POS provider expansion (Nov 14, 2026). One of
 * the adapters over the shared core (server/posCore.js), shaped
 * like server/posSquare.js.
 *
 * Built to Clover's documented public API (docs.clover.com):
 *   - Connect is OAuth v2: the merchant approves the app on
 *     Clover's own page; the callback exchanges the code at
 *     POST {api}/oauth/v2/token. App id + secret are platform
 *     credentials (CLOVER_APP_ID / CLOVER_APP_SECRET, Fly
 *     secrets). Without them the connect action answers a plain
 *     "not configured yet" — fail closed, no fake state.
 *   - Webhooks POST { appId, merchants: { <merchantId>: [
 *     { objectId: "O:<orderId>", type: "CREATE"|"UPDATE"|"DELETE",
 *       ts } ] } } to the endpoint registered in the app
 *     dashboard. Events carry ONLY object ids — no order body —
 *     so the adapter FETCHES the order with the merchant's stored
 *     OAuth token: GET {api}/v3/merchants/{mId}/orders/{orderId}
 *     ?expand=lineItems (order totals are in cents; line items
 *     carry item { id, sku }, name, price, quantity).
 *   - Delivery authenticity: Clover sends the app's Auth Code in
 *     the `X-Clover-Auth` header (the per-app shared secret shown
 *     in the Developer Dashboard). CLOVER_WEBHOOK_AUTH_CODE is
 *     that code; without it the receiver answers 503, and a
 *     mismatch is refused 400 — never 200 for an unverified
 *     event. The dashboard's setup ping (a body carrying
 *     `verificationCode`) is answered 200 once the header checks
 *     out, and records nothing.
 *
 * External step remaining (go-live paperwork, not code): a
 * Clover developer account + app registration, merchants
 * installing the app, and the webhook subscription + Auth Code
 * set in that dashboard.
 */
import crypto from 'node:crypto';
import { config } from './config.js';
import { getPool } from './db.js';
import { planFor } from './plans.js';
import { hasFullSubscriptionAccess } from './subscriptionAccess.js';
import { applyPosSale } from './posCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function cloverConfig() {
  const appId = process.env.CLOVER_APP_ID || '';
  const appSecret = process.env.CLOVER_APP_SECRET || '';
  const authCode = process.env.CLOVER_WEBHOOK_AUTH_CODE || '';
  return {
    appId,
    appSecret,
    authCode,
    apiBase: (process.env.CLOVER_API_BASE || 'https://api.clover.com').replace(/\/+$/, ''),
    webBase: (process.env.CLOVER_WEB_BASE || 'https://www.clover.com').replace(/\/+$/, ''),
    redirectUri: process.env.CLOVER_REDIRECT_URI || '',
    oauthConfigured: Boolean(appId && appSecret),
    webhookConfigured: Boolean(authCode),
  };
}

/** OAuth state: the business id, HMAC-signed (the Square pattern). */
export function signCloverState(businessId) {
  const mac = crypto.createHmac('sha256', config.sessionSecret || '').update(`pos-clover:${businessId}`).digest('hex');
  return `${businessId}.${mac}`;
}

export function verifyCloverState(state) {
  const [businessId, mac] = String(state || '').split('.');
  if (!businessId || !mac) return null;
  const expected = signCloverState(businessId).split('.')[1];
  const a = Buffer.from(mac, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return businessId;
}

export function cloverAuthorizeUrl(businessId) {
  const cfg = cloverConfig();
  if (!cfg.oauthConfigured) return null;
  const params = new URLSearchParams({
    client_id: cfg.appId,
    response_type: 'code',
    state: signCloverState(businessId),
  });
  if (cfg.redirectUri) params.set('redirect_uri', cfg.redirectUri);
  return `${cfg.webBase}/oauth/v2/authorize?${params.toString()}`;
}

/** Exchange an OAuth code for tokens. Throws pos_not_configured when env is absent. */
export async function exchangeCloverCode(code, fetchImpl = fetch) {
  const cfg = cloverConfig();
  if (!cfg.oauthConfigured) {
    throw err(503, 'pos_not_configured', 'Clover is not configured yet — the app owner has not added the Clover keys.');
  }
  const res = await fetchImpl(`${cfg.apiBase}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.appId, client_secret: cfg.appSecret, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw err(400, 'clover_oauth_failed', 'Clover did not complete the connection. Please try connecting again.');
  }
  return data;
}

/** Fetch one order (with line items) using the merchant's OAuth token. */
export async function fetchCloverOrder(connection, merchantId, orderId, fetchImpl = fetch) {
  const cfg = cloverConfig();
  let credentials = {};
  try { credentials = JSON.parse(connection?.credentials || '{}'); } catch { credentials = {}; }
  const token = credentials.access_token || '';
  if (!token) {
    throw err(409, 'clover_token_missing', 'This Clover connection has no access token stored — reconnect Clover.');
  }
  const res = await fetchImpl(
    `${cfg.apiBase}/v3/merchants/${encodeURIComponent(merchantId)}/orders/${encodeURIComponent(orderId)}?expand=lineItems`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.id) {
    throw err(502, 'clover_order_fetch_failed', 'Clover did not return that order.');
  }
  return data;
}

/** Clover order object → the shared normalized sale shape. Totals are cents. */
export function normalizeCloverOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const externalSaleId = String(order.id || '').trim();
  if (!externalSaleId) return null;
  const elements = Array.isArray(order.lineItems?.elements) ? order.lineItems.elements : [];
  const lines = elements
    .filter((el) => el && el.refunded !== true)
    .map((el) => ({
      providerItemKey: el.item?.id ? `item:${el.item.id}` : `line:${el.id || ''}`,
      itemLabel: String(el.name || el.item?.name || ''),
      sku: String(el.item?.sku || ''),
      barcode: '',
      quantity: Number(el.quantity) || 0,
    }));
  return {
    externalSaleId,
    soldAt: order.createdTime ? new Date(Number(order.createdTime)).toISOString() : null,
    locationLabel: '',
    totalAmount: order.total != null && order.total !== '' ? Number(order.total) / 100 : null,
    totalCurrency: String(order.currency || ''),
    summary: `Clover order ${externalSaleId}`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// OAuth callback — GET /api/pos/clover/callback?code&merchant_id&state.
// Same discipline as Square's: the HMAC-signed state names the one
// business that may complete, and the plan is re-checked (Business
// only) before any token is stored.
// ---------------------------------------------------------------------------

export async function cloverOAuthCallbackHandler(req, res) {
  const fail = () => res.redirect('/pos?clover=failed');
  const pool = getPool();
  if (!pool) return fail();
  const businessId = verifyCloverState(req.query?.state);
  if (!businessId || !req.query?.code) return fail();
  try {
    const { rows: businessRows } = await pool.query('SELECT id FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
    if (!businessRows[0]) return fail();
    if ((await planFor(pool, businessId)) !== 'business') return fail();
    const tokens = await exchangeCloverCode(String(req.query.code));
    // Clover returns the merchant id on the redirect (and in some
    // token shapes); either source names the account webhooks
    // will look up.
    const merchantId = String(req.query?.merchant_id || tokens.merchant_id || '');
    // One Clover merchant, one subscriber (the Square rule).
    if (merchantId) {
      await pool.query(
        "UPDATE pos_connections SET status = 'not_connected', credentials = '', updated_at = NOW() WHERE provider = 'clover' AND provider_account_id = $1 AND business_id <> $2",
        [merchantId, businessId],
      );
    }
    const credentials = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      expires_at: tokens.access_token_expiration || '',
    });
    const existing = await pool.query(
      "SELECT id FROM pos_connections WHERE business_id = $1 AND provider = 'clover' LIMIT 1",
      [businessId],
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE pos_connections
            SET status = 'connected', provider_account_id = $1, credentials = $2,
                last_error = '', updated_at = NOW()
          WHERE id = $3`,
        [merchantId, credentials, existing.rows[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO pos_connections (id, business_id, provider, status, provider_account_id, credentials)
         VALUES ($1, $2, 'clover', 'connected', $3, $4)`,
        [crypto.randomUUID(), businessId, merchantId, credentials],
      );
    }
    return res.redirect('/pos?clover=connected');
  } catch (error) {
    console.error('[twin] Clover OAuth callback failed:', error?.message || error);
    return fail();
  }
}

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/clover (express.raw, raw body kept).
// ---------------------------------------------------------------------------

export async function cloverWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const cfg = cloverConfig();
  if (!cfg.webhookConfigured) {
    return res.status(503).json({ error: 'pos_not_configured', message: 'The Clover webhook is not configured yet.' });
  }
  const provided = Buffer.from(String(req.get('x-clover-auth') || ''), 'utf8');
  const expected = Buffer.from(cfg.authCode, 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    console.error('[twin] Clover webhook rejected (bad X-Clover-Auth) — never 200 for an unverified event.');
    return res.status(400).json({ error: 'invalid_signature', reason: 'bad_auth_code' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  // The dashboard's endpoint-verification ping: it carries a
  // verificationCode and no merchant events. Answer it (the header
  // already checked out) and record nothing.
  if (payload && typeof payload === 'object' && payload.verificationCode) {
    return res.json({ received: true, recorded: false, reason: 'endpoint verification' });
  }
  const merchants = payload?.merchants && typeof payload.merchants === 'object' ? payload.merchants : {};
  const results = [];
  let matchedAny = false;
  for (const [merchantId, events] of Object.entries(merchants)) {
    const { rows } = await pool.query(
      "SELECT * FROM pos_connections WHERE provider = 'clover' AND provider_account_id = $1 AND status = 'connected' LIMIT 1",
      [merchantId],
    );
    const connection = rows[0];
    if (!connection) continue;
    matchedAny = true;
    const planKey = await planFor(pool, connection.business_id);
    const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
    for (const event of Array.isArray(events) ? events : []) {
      const objectId = String(event?.objectId || '');
      if (!objectId.startsWith('O:')) continue;
      if (!['CREATE', 'UPDATE'].includes(String(event?.type || ''))) continue;
      const orderId = objectId.slice(2);
      let sale = null;
      try {
        const order = await fetchCloverOrder(connection, merchantId, orderId);
        sale = normalizeCloverOrder(order);
      } catch (error) {
        // Answer 500 so Clover retries; a lost fetch must not be
        // acknowledged as received (the Shopify discipline).
        console.error('[twin] Clover order fetch failed:', error?.message || error);
        return res.status(500).json({ error: 'pos_webhook_error' });
      }
      if (!sale) continue;
      const result = await applyPosSale(pool, {
        businessId: connection.business_id,
        connection,
        provider: 'clover',
        source: 'webhook',
        sale,
        planKey,
        // Plan gate (owner's ruling, Nov 13, 2026): held, never
        // lost, never applied while off Business / unentitled.
        holdForPlan: planKey !== 'business' || !entitled,
      });
      results.push({ order: orderId, duplicate: result.duplicate, status: result.event.status });
    }
  }
  if (!matchedAny) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No connected business matches this Clover merchant.' });
  }
  return res.json({ received: true, results });
}

/**
 * eBay adapter — storefront connections (release 362).
 *
 * One of the adapters over the shared sale core
 * (server/posCore.js), shaped like the Square adapter — but a
 * STOREFRONT, not a till: the owner's ruling (Nov 23, 2026)
 * puts storefront connections on BOTH plans, so nothing here
 * holds a sale for plan. A sale that arrives while the
 * business's subscription is not access-granting is still
 * recorded HELD (never lost, never applied for free) — the
 * same subscription hold the till adapters apply.
 *
 * Posture: FAIL CLOSED, like the mailer and the Stripe
 * webhook.
 *   - OAuth connect needs EBAY_APP_ID + EBAY_CERT_ID +
 *     EBAY_RU_NAME (Fly secrets, from the eBay developer
 *     portal). Without them the connect action answers a
 *     plain "not configured yet" — no fake connected state,
 *     no crash. The keyset is the PUBLISH gate for this
 *     release, not a build blocker.
 *   - Notifications are trusted only after the
 *     X-EBAY-SIGNATURE header verifies against eBay's public
 *     key (Notification API getPublicKey). An unverified
 *     payload is refused, never 200, and nothing it carried
 *     is recorded or logged beyond the refusal reason.
 *   - MARKETPLACE_ACCOUNT_DELETION — the topic eBay mandates
 *     every notification subscriber handle — severs the
 *     deleting seller's connection (their credential material
 *     is the only eBay personal data this app holds) and
 *     writes an audit row.
 *
 * THE ORDER IS THE TRUTH: an ITEM_SOLD notification is a
 * trigger, not the record. On a verified notification the
 * adapter fetches the full order through the Sell
 * Fulfillment API with the connection's own token and
 * applies THAT; if the fetch fails it falls back to the
 * lines the payload itself carried. The catch-up sweep
 * (runEbaySweep, composed into the sweep scheduler) pulls
 * getOrders by lastmodifieddate since the connection's
 * watermark. Both roads land on the core's idempotency
 * anchor — (business, 'ebay', order id) — so whichever
 * arrives first records the sale and every later arrival is
 * the recorded outcome, never a second decrement.
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

export function ebayConfig() {
  const appId = process.env.EBAY_APP_ID || '';
  const certId = process.env.EBAY_CERT_ID || '';
  const ruName = process.env.EBAY_RU_NAME || '';
  return {
    appId,
    certId,
    ruName,
    verificationToken: process.env.EBAY_VERIFICATION_TOKEN || '',
    webhookUrl: process.env.EBAY_WEBHOOK_URL || '',
    environment: process.env.EBAY_ENVIRONMENT || 'production',
    oauthConfigured: Boolean(appId && certId && ruName),
  };
}

const ebayAuthHost = (environment) =>
  environment === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com';
const ebayApiHost = (environment) =>
  environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
].join(' ');

/** OAuth state: the business id, HMAC-signed so a callback cannot be forged onto another business. */
export function signEbayState(businessId) {
  const mac = crypto.createHmac('sha256', config.sessionSecret || '').update(`ebay-storefront:${businessId}`).digest('hex');
  return `${businessId}.${mac}`;
}

export function verifyEbayState(state) {
  const [businessId, mac] = String(state || '').split('.');
  if (!businessId || !mac) return null;
  const expected = signEbayState(businessId).split('.')[1];
  const a = Buffer.from(mac, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return businessId;
}

export function ebayAuthorizeUrl(businessId) {
  const cfg = ebayConfig();
  if (!cfg.oauthConfigured) return null;
  const params = new URLSearchParams({
    client_id: cfg.appId,
    response_type: 'code',
    redirect_uri: cfg.ruName,
    scope: EBAY_SCOPES,
    state: signEbayState(businessId),
  });
  return `${ebayAuthHost(cfg.environment)}/oauth2/authorize?${params.toString()}`;
}

function basicAuthHeader(cfg) {
  return `Basic ${Buffer.from(`${cfg.appId}:${cfg.certId}`, 'utf8').toString('base64')}`;
}

/** Exchange an OAuth code for the seller's tokens. Throws ebay_not_configured when env is absent. */
export async function exchangeEbayCode(code, fetchImpl = fetch) {
  const cfg = ebayConfig();
  if (!cfg.oauthConfigured) {
    throw err(503, 'ebay_not_configured', 'eBay is not configured yet — the app owner has not added the eBay keys.');
  }
  const res = await fetchImpl(`${ebayApiHost(cfg.environment)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader(cfg) },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      redirect_uri: cfg.ruName,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw err(400, 'ebay_oauth_failed', 'eBay did not complete the connection. Please try connecting again.');
  }
  return data;
}

/** Refresh a seller token. Returns the token payload or null when eBay refuses. */
export async function refreshEbayToken(refreshToken, fetchImpl = fetch) {
  const cfg = ebayConfig();
  if (!cfg.oauthConfigured || !refreshToken) return null;
  const res = await fetchImpl(`${ebayApiHost(cfg.environment)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader(cfg) },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken),
      scope: EBAY_SCOPES,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  return data;
}

/** The seller behind a user token (Commerce Identity API) — the connection's routing identity. */
export async function fetchEbaySeller(accessToken, fetchImpl = fetch) {
  const cfg = ebayConfig();
  try {
    const res = await fetchImpl(`${ebayApiHost(cfg.environment)}/commerce/identity/v1/user/`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (!data?.userId && !data?.username) return null;
    return { userId: String(data.userId || ''), username: String(data.username || '') };
  } catch {
    return null;
  }
}

export function parseEbayCredentials(connection) {
  try {
    return JSON.parse(connection?.credentials || '') || {};
  } catch {
    return {};
  }
}

function credentialsJson(tokens, previous = {}) {
  const expiresIn = Number(tokens.expires_in) || 0;
  return JSON.stringify({
    access_token: tokens['access_token'] || previous.access_token || '',
    refresh_token: tokens['refresh_token'] || previous.refresh_token || '',
    expires_at: expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : previous.expires_at || '',
  });
}

/** A usable access token for a connection, refreshing (and persisting) when the stored one lapses. */
export async function ebayAccessToken(pool, connection, fetchImpl = fetch) {
  const creds = parseEbayCredentials(connection);
  const expiresAt = creds.expires_at ? Date.parse(creds.expires_at) : NaN;
  if (creds.access_token && Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) {
    return creds.access_token;
  }
  if (creds.access_token && !Number.isFinite(expiresAt)) return creds.access_token;
  const refreshed = await refreshEbayToken(creds.refresh_token, fetchImpl);
  if (!refreshed) return creds.access_token || null;
  const next = credentialsJson(refreshed, creds);
  await pool.query('UPDATE pos_connections SET credentials = $1, updated_at = NOW() WHERE id = $2', [next, connection.id]);
  connection.credentials = next;
  return refreshed.access_token;
}

// ---------------------------------------------------------------------------
// Notification plumbing — app token, public keys, signature.
// ---------------------------------------------------------------------------

let appTokenCache = { token: null, expiresAt: 0 };

/** The application token (client-credentials grant) the Notification API calls ride on. */
export async function ebayAppToken(fetchImpl = fetch) {
  const cfg = ebayConfig();
  if (!cfg.oauthConfigured) return null;
  if (appTokenCache.token && appTokenCache.expiresAt - Date.now() > 60_000) return appTokenCache.token;
  const res = await fetchImpl(`${ebayApiHost(cfg.environment)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader(cfg) },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  appTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
  };
  return appTokenCache.token;
}

const publicKeyCache = new Map();

/** eBay's notification signing key for a key id (Notification API getPublicKey). */
export async function ebayPublicKey(kid, fetchImpl = fetch) {
  if (publicKeyCache.has(kid)) return publicKeyCache.get(kid);
  const cfg = ebayConfig();
  const token = await ebayAppToken(fetchImpl);
  if (!token) return null;
  const res = await fetchImpl(
    `${ebayApiHost(cfg.environment)}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const key = typeof data?.key === 'string' ? data.key : null;
  if (key) publicKeyCache.set(kid, key);
  return key;
}

/**
 * Verify an X-EBAY-SIGNATURE header over the raw body. The
 * header is base64 JSON { alg, kid, signature } where the
 * signature is ECDSA-SHA256 over the exact bytes received.
 */
export async function verifyEbaySignature(rawBody, signatureHeader, fetchImpl = fetch) {
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(signatureHeader), 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  const kid = decoded?.kid;
  const signature = decoded?.signature;
  if (!kid || !signature) return { ok: false, reason: 'bad_signature' };
  const key = await ebayPublicKey(kid, fetchImpl);
  if (!key) return { ok: false, reason: 'public_key_unavailable' };
  try {
    const keyObject = crypto.createPublicKey(key);
    // eBay signs in the raw IEEE P1363 encoding (r‖s) — say so,
    // or Node expects DER and every genuine signature fails.
    const ok = crypto.verify(
      'sha256',
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8'),
      { key: keyObject, dsaEncoding: 'ieee-p1363' },
      Buffer.from(String(signature), 'base64'),
    );
    return ok ? { ok: true, reason: null } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

/** The destination-verification answer eBay expects on its challenge GET. */
export function ebayChallengeResponse(challengeCode, endpoint = ebayConfig().webhookUrl) {
  const cfg = ebayConfig();
  return crypto
    .createHash('sha256')
    .update(`${challengeCode}${cfg.verificationToken}${endpoint}`, 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Normalizers — eBay shapes → the shared normalized sale.
// ---------------------------------------------------------------------------

function lineFromEbay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = String(raw.itemId || raw.legacyItemId || raw.item_id || '');
  const sku = String(raw.sku || raw.itemSku || raw.customLabel || '');
  const quantity = Number(raw.quantity ?? raw.quantitySold ?? 1) || 0;
  return {
    providerItemKey: itemId || sku,
    itemLabel: String(raw.title || raw.itemTitle || raw.name || ''),
    sku,
    // The listings import carries the eBay SKU as the product's
    // own SKU; the core's code match reads sku first and the
    // other code fields second, so the SKU rides both slots.
    barcode: sku,
    quantity,
  };
}

/** A Sell Fulfillment order → the normalized sale. */
export function normalizeEbayOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const externalSaleId = String(order.orderId || order.order_id || '').trim();
  if (!externalSaleId) return null;
  const lines = (Array.isArray(order.lineItems) ? order.lineItems : []).map(lineFromEbay).filter(Boolean);
  const total = order.pricingSummary?.total || order.total || null;
  return {
    externalSaleId,
    soldAt: order.creationDate || order.createdAt || null,
    locationLabel: '',
    totalAmount: total && total.value != null ? Number(total.value) : null,
    totalCurrency: total?.currency || '',
    summary: `eBay order ${externalSaleId}`,
    lines,
  };
}

/** An ITEM_SOLD notification payload → { sellerKey, orderId, sale } (the payload's own lines as the fallback record). */
export function normalizeEbaySoldNotification(payload) {
  const data = payload?.notification?.data;
  if (!data || typeof data !== 'object') return null;
  const orderId = String(data.orderId || data.order_id || '').trim();
  if (!orderId) return null;
  const rawLines = Array.isArray(data.lineItems) ? data.lineItems : data.itemId || data.legacyItemId ? [data] : [];
  const lines = rawLines.map(lineFromEbay).filter(Boolean);
  const sellerKey = String(
    data.username || data.sellerUsername || data.userId || data.sellerUserId || data.seller?.username || data.seller?.userId || '',
  );
  return {
    sellerKey,
    orderId,
    sale: {
      externalSaleId: orderId,
      soldAt: data.creationDate || payload.notification?.eventDate || null,
      locationLabel: '',
      totalAmount:
        data.pricingSummary?.total?.value != null
          ? Number(data.pricingSummary.total.value)
          : data.orderTotal?.value != null
            ? Number(data.orderTotal.value)
            : null,
      totalCurrency: data.pricingSummary?.total?.currency || data.orderTotal?.currency || '',
      summary: `eBay order ${orderId}`,
      lines,
    },
  };
}

// ---------------------------------------------------------------------------
// Orders — the Sell Fulfillment reads the sweep and the
// notification trigger share.
// ---------------------------------------------------------------------------

async function ebayGet(pool, connection, path, fetchImpl) {
  const cfg = ebayConfig();
  const token = await ebayAccessToken(pool, connection, fetchImpl);
  if (!token) return null;
  const res = await fetchImpl(`${ebayApiHost(cfg.environment)}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** One order by id, or null. */
export async function fetchEbayOrder(pool, connection, orderId, fetchImpl = fetch) {
  const data = await ebayGet(
    pool,
    connection,
    `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`,
    fetchImpl,
  );
  return data && typeof data === 'object' ? data : null;
}

/** Orders modified since an instant (the catch-up read), paged defensively. */
export async function fetchEbayOrdersSince(pool, connection, since, fetchImpl = fetch) {
  const orders = [];
  const limit = 200;
  for (let page = 0; page < 10; page += 1) {
    const filter = encodeURIComponent(`lastmodifieddate:[${since.toISOString()}..]`);
    const data = await ebayGet(
      pool,
      connection,
      `/sell/fulfillment/v1/order?filter=${filter}&limit=${limit}&offset=${page * limit}`,
      fetchImpl,
    );
    if (!data) return page === 0 ? null : orders;
    const batch = Array.isArray(data.orders) ? data.orders : [];
    orders.push(...batch);
    if (batch.length < limit) break;
  }
  return orders;
}

// ---------------------------------------------------------------------------
// Application — one road for notifications and sweeps alike.
// ---------------------------------------------------------------------------

/**
 * Record + apply one eBay order for a connection. Both plans
 * apply (storefront ruling); the only hold is the subscription
 * hold — a workspace whose subscription is not currently
 * access-granting keeps the sale recorded, never applied.
 */
export async function applyEbaySale(pool, { connection, sale, source = 'webhook' }) {
  const planKey = await planFor(pool, connection.business_id);
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  return applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'ebay',
    source,
    sale,
    planKey,
    holdForPlan: !entitled,
  });
}

/**
 * The catch-up sweep for ONE connection: pull orders modified
 * since the watermark (minus a 15-minute overlap the
 * idempotency anchor makes safe; 7 days back on the first
 * run), apply each through the same road, advance the
 * watermark. Returns a small summary; never throws.
 */
export async function sweepEbayConnection(pool, connection, { now = new Date(), fetchImpl = fetch, logger = console } = {}) {
  const summary = { connectionId: connection.id, orders: 0, applied: 0, duplicates: 0, error: null };
  try {
    const { rows } = await pool.query('SELECT * FROM ebay_sweep_state WHERE connection_id = $1 LIMIT 1', [connection.id]);
    const state = rows[0];
    const watermark = state?.last_sweep_at
      ? new Date(new Date(state.last_sweep_at).getTime() - 15 * 60 * 1000)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const orders = await fetchEbayOrdersSince(pool, connection, watermark, fetchImpl);
    if (!orders) {
      summary.error = 'orders_unavailable';
      await pool.query(
        `INSERT INTO ebay_sweep_state (connection_id, last_error, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (connection_id) DO UPDATE SET last_error = $2, updated_at = NOW()`,
        [connection.id, summary.error],
      );
      return summary;
    }
    for (const order of orders) {
      const sale = normalizeEbayOrder(order);
      if (!sale) continue;
      summary.orders += 1;
      const result = await applyEbaySale(pool, { connection, sale, source: 'sweep' });
      if (result.duplicate) summary.duplicates += 1;
      else summary.applied += 1;
    }
    await pool.query(
      `INSERT INTO ebay_sweep_state (connection_id, last_sweep_at, last_error, updated_at) VALUES ($1, $2, '', NOW())
       ON CONFLICT (connection_id) DO UPDATE SET last_sweep_at = $2, last_error = '', updated_at = NOW()`,
      [connection.id, now.toISOString()],
    );
    return summary;
  } catch (error) {
    summary.error = error.message;
    logger.error(`[twin] eBay sweep failed for connection ${connection.id}: ${error.message}`);
    return summary;
  }
}

/** Every connected eBay storefront, swept — the scheduler's composition unit. Never throws. */
export async function runEbaySweep(pool, { now = new Date(), logger = console, fetchImpl = fetch } = {}) {
  const summary = { connections: 0, orders: 0, applied: 0, duplicates: 0, failures: [] };
  if (!pool) return summary;
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'ebay' AND status = 'connected'",
  );
  summary.connections = rows.length;
  for (const connection of rows) {
    const one = await sweepEbayConnection(pool, connection, { now, logger, fetchImpl });
    summary.orders += one.orders;
    summary.applied += one.applied;
    summary.duplicates += one.duplicates;
    if (one.error) summary.failures.push({ connectionId: connection.id, reason: one.error });
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Notification subscriptions — best effort at connect time.
// The destination is the app's one notification endpoint;
// subscriptions are app-level, so they are ensured, never
// torn down by one store disconnecting.
// ---------------------------------------------------------------------------

export async function ensureEbaySubscriptions(fetchImpl = fetch) {
  const cfg = ebayConfig();
  if (!cfg.oauthConfigured || !cfg.webhookUrl || !cfg.verificationToken) {
    return { ok: false, reason: 'webhook_not_configured' };
  }
  const token = await ebayAppToken(fetchImpl);
  if (!token) return { ok: false, reason: 'app_token_unavailable' };
  const host = ebayApiHost(cfg.environment);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const destRes = await fetchImpl(`${host}/commerce/notification/v1/destination`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Luminous StockHaven storefront sales',
        deliveryConfig: { endpoint: cfg.webhookUrl, verificationToken: cfg.verificationToken },
      }),
    });
    const dest = await destRes.json().catch(() => ({}));
    const destinationId = dest?.destinationId;
    if (!destRes.ok || !destinationId) return { ok: false, reason: 'destination_failed' };
    for (const topicId of ['ITEM_SOLD', 'MARKETPLACE_ACCOUNT_DELETION']) {
      const subRes = await fetchImpl(`${host}/commerce/notification/v1/subscription`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ topicId, destinationId, status: 'ENABLED', payloadEncoding: 'JSON' }),
      });
      if (!subRes.ok) return { ok: false, reason: `subscription_failed:${topicId}` };
    }
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

// ---------------------------------------------------------------------------
// OAuth callback — GET /api/pos/ebay/callback?code&state.
// The state carries the HMAC-signed business id, so a callback
// can only ever land on the business that started it. Success
// and failure both bounce back to the Storefront connections
// page with a plain flag in the query string.
// ---------------------------------------------------------------------------

export async function ebayOAuthCallbackHandler(req, res) {
  const fail = () => res.redirect('/storefronts?ebay=failed');
  const pool = getPool();
  if (!pool) return fail();
  const businessId = verifyEbayState(req.query?.state);
  if (!businessId || !req.query?.code) return fail();
  try {
    const { rows: businessRows } = await pool.query('SELECT id FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
    if (!businessRows[0]) return fail();
    // NO plan gate (storefront ruling, Nov 23, 2026): Essentials
    // and Business complete this connection alike.
    const tokens = await exchangeEbayCode(String(req.query.code));
    const accessToken = tokens['access_token'];
    const seller = accessToken ? await fetchEbaySeller(accessToken) : null;
    const sellerId = seller?.userId || '';
    const sellerName = seller?.username || '';
    // One eBay account, one business: if this store was
    // connected to another workspace, that connection ends
    // here — notifications find their business by seller.
    if (sellerId) {
      await pool.query(
        "UPDATE pos_connections SET status = 'not_connected', credentials = '', updated_at = NOW() WHERE provider = 'ebay' AND provider_account_id = $1 AND business_id <> $2",
        [sellerId, businessId],
      );
    }
    const credentials = credentialsJson(tokens);
    const existing = await pool.query(
      "SELECT id FROM pos_connections WHERE business_id = $1 AND provider = 'ebay' LIMIT 1",
      [businessId],
    );
    let connectionId;
    if (existing.rows[0]) {
      connectionId = existing.rows[0].id;
      await pool.query(
        `UPDATE pos_connections
            SET status = 'connected', provider_account_id = $1, label = $2, credentials = $3,
                last_error = '', updated_at = NOW()
          WHERE id = $4`,
        [sellerId, sellerName, credentials, connectionId],
      );
    } else {
      connectionId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO pos_connections (id, business_id, provider, status, provider_account_id, label, credentials)
         VALUES ($1, $2, 'ebay', 'connected', $3, $4, $5)`,
        [connectionId, businessId, sellerId, sellerName, credentials],
      );
    }
    const subs = await ensureEbaySubscriptions();
    if (!subs.ok) {
      // The connection itself is complete — the sweep road
      // needs no subscription — so a subscription failure is
      // a note on the connection, never a failed connect.
      await pool.query('UPDATE pos_connections SET last_error = $1, updated_at = NOW() WHERE id = $2', [
        `Notification sign-up did not complete (${subs.reason}); sales still arrive by the regular check.`,
        connectionId,
      ]);
    }
    return res.redirect('/storefronts?ebay=connected');
  } catch (error) {
    console.error('[twin] eBay OAuth callback failed:', error?.message || error);
    return fail();
  }
}

// ---------------------------------------------------------------------------
// Notification endpoint — POST /webhooks/pos/ebay (raw body)
// and its destination-verification GET on the same path.
// ---------------------------------------------------------------------------

/** Find the connection a verified notification belongs to. */
export async function ebayConnectionForSeller(pool, sellerKey) {
  if (sellerKey) {
    const { rows } = await pool.query(
      "SELECT * FROM pos_connections WHERE provider = 'ebay' AND status = 'connected' AND (provider_account_id = $1 OR label = $1) LIMIT 1",
      [sellerKey],
    );
    if (rows[0]) return rows[0];
  }
  // The payload named nobody we know. With exactly one eBay
  // storefront connected in the whole app there is no
  // ambiguity to resolve — and the per-connection sweep
  // reconciles every order either way, so a notification can
  // speed a sale up but can never be the only copy of it.
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'ebay' AND status = 'connected'",
  );
  if (rows.length === 1) return rows[0];
  return null;
}

/** MARKETPLACE_ACCOUNT_DELETION: sever the seller's connection and audit the handling. */
export async function handleEbayAccountDeletion(pool, payload) {
  const data = payload?.notification?.data || {};
  const userId = String(data.userId || data.user_id || '');
  const username = String(data.username || data.userName || '');
  let action = 'no_matching_connection';
  if (userId || username) {
    const { rowCount } = await pool.query(
      `UPDATE pos_connections
          SET status = 'not_connected', credentials = '', provider_account_id = '', label = '', updated_at = NOW()
        WHERE provider = 'ebay' AND (provider_account_id = $1 OR label = $2)`,
      [userId, username],
    );
    if (rowCount > 0) action = 'connection_severed';
  }
  await pool.query(
    'INSERT INTO ebay_account_deletions (id, ebay_user_id, username, action) VALUES ($1, $2, $3, $4)',
    [crypto.randomUUID(), userId, username, action],
  );
  return action;
}

export async function ebayChallengeHandler(req, res) {
  const cfg = ebayConfig();
  const challengeCode = req.query?.challenge_code;
  if (!challengeCode || !cfg.verificationToken || !cfg.webhookUrl) {
    return res.status(400).json({ error: 'challenge_not_configured' });
  }
  return res.json({ challengeResponse: ebayChallengeResponse(String(challengeCode)) });
}

export async function ebayWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const cfg = ebayConfig();
  if (!cfg.oauthConfigured) {
    return res.status(503).json({ error: 'ebay_not_configured', message: 'The eBay notification endpoint is not configured yet.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const check = await verifyEbaySignature(rawBody, req.get('x-ebay-signature'));
  if (!check.ok) {
    console.error(`[twin] eBay notification rejected (${check.reason}) — never 200 for an unverified event.`);
    return res.status(400).json({ error: 'invalid_signature', reason: check.reason });
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Notification body is not valid JSON.' });
  }
  const topic = String(payload?.metadata?.topic || '');
  if (topic === 'MARKETPLACE_ACCOUNT_DELETION') {
    const action = await handleEbayAccountDeletion(pool, payload);
    return res.json({ received: true, recorded: true, action });
  }
  if (topic !== 'ITEM_SOLD') {
    return res.json({ received: true, recorded: false, reason: 'not a sale topic' });
  }
  const normalized = normalizeEbaySoldNotification(payload);
  if (!normalized) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The sale notification has no order id.' });
  }
  const connection = await ebayConnectionForSeller(pool, normalized.sellerKey);
  if (!connection) {
    console.error('[twin] eBay sale notification could not be routed to a connected business; the catch-up sweep remains the record.');
    return res.json({ received: true, recorded: false, reason: 'seller_not_identified' });
  }
  // The order is the truth: fetch it whole with the
  // connection's own token; the payload's lines are the
  // fallback when the fetch cannot complete.
  let sale = normalized.sale;
  const order = await fetchEbayOrder(pool, connection, normalized.orderId).catch(() => null);
  if (order) {
    const fromOrder = normalizeEbayOrder(order);
    if (fromOrder && fromOrder.lines.length) sale = fromOrder;
  }
  const result = await applyEbaySale(pool, { connection, sale, source: 'webhook' });
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

/**
 * Square adapter — POS phase. One of two adapters over the shared
 * core (server/posCore.js); a future provider copies this shape.
 *
 * Posture: FAIL CLOSED, like the mailer and the Stripe webhook.
 *   - OAuth connect needs SQUARE_APP_ID + SQUARE_APP_SECRET (Fly
 *     secrets). Without them the connect action answers a plain
 *     "not configured yet" — no fake connected state, no crash.
 *   - The webhook needs SQUARE_WEBHOOK_SIGNATURE_KEY. Without it
 *     the receiver answers 503; with it, every payload's HMAC is
 *     verified over (notification URL + raw body) before anything
 *     is recorded. Unverified payloads are refused, never 200.
 *
 * Square order line items do NOT carry the SKU — the SKU lives on
 * the catalog variation. So the durable match key here is the
 * catalog_object_id (the provider item key mappings hang off);
 * when a payload does carry a sku, it is used too. Live SKU
 * resolution via the Catalog API is a go-live step (see the POS
 * report) — the mapping screen covers it until then.
 *
 * Payment events carry no line items, so they can never move
 * stock: they are acknowledged and recorded as nothing. The ORDER
 * events (order.created / order.updated) are what move stock.
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

export function squareConfig() {
  const appId = process.env.SQUARE_APP_ID || '';
  const appSecret = process.env.SQUARE_APP_SECRET || '';
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
  return {
    appId,
    appSecret,
    environment: process.env.SQUARE_ENVIRONMENT || 'production',
    signatureKey,
    webhookUrl: process.env.SQUARE_WEBHOOK_URL || '',
    oauthConfigured: Boolean(appId && appSecret),
    webhookConfigured: Boolean(signatureKey),
  };
}

const squareHost = (environment) =>
  environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';

/** OAuth state: the business id, HMAC-signed so a callback cannot be forged onto another business. */
export function signSquareState(businessId) {
  const mac = crypto.createHmac('sha256', config.sessionSecret || '').update(`pos-square:${businessId}`).digest('hex');
  return `${businessId}.${mac}`;
}

export function verifySquareState(state) {
  const [businessId, mac] = String(state || '').split('.');
  if (!businessId || !mac) return null;
  const expected = signSquareState(businessId).split('.')[1];
  const a = Buffer.from(mac, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return businessId;
}

export function squareAuthorizeUrl(businessId) {
  const cfg = squareConfig();
  if (!cfg.oauthConfigured) return null;
  const params = new URLSearchParams({
    client_id: cfg.appId,
    scope: 'ORDERS_READ PAYMENTS_READ INVENTORY_READ ITEMS_READ MERCHANT_PROFILE_READ',
    session: 'false',
    state: signSquareState(businessId),
  });
  return `${squareHost(cfg.environment)}/oauth2/authorize?${params.toString()}`;
}

/** Exchange an OAuth code for tokens. Throws pos_not_configured when env is absent. */
export async function exchangeSquareCode(code, fetchImpl = fetch) {
  const cfg = squareConfig();
  if (!cfg.oauthConfigured) {
    throw err(503, 'pos_not_configured', 'Square is not configured yet — the app owner has not added the Square keys.');
  }
  const res = await fetchImpl(`${squareHost(cfg.environment)}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Square-Version': '2024-12-18' },
    body: JSON.stringify({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw err(400, 'square_oauth_failed', 'Square did not complete the connection. Please try connecting again.');
  }
  return data;
}

/** Square signs HMAC-SHA256 over (notification URL + raw body), base64. */
export function verifySquareSignature(rawBody, signatureHeader, url, signatureKey) {
  if (!signatureKey) return { ok: false, reason: 'webhook_key_not_configured' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  const expected = crypto
    .createHmac('sha256', signatureKey)
    .update(`${url}${rawBody}`, 'utf8')
    .digest('base64');
  const a = Buffer.from(String(signatureHeader), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, reason: null };
}

/** Square order object → the shared normalized sale shape. */
export function normalizeSquareOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const externalSaleId = String(order.id || order.order_id || '').trim();
  if (!externalSaleId) return null;
  const lines = (Array.isArray(order.line_items) ? order.line_items : []).map((item) => {
    const label = [item.name, item.variation_name].filter(Boolean).join(' — ');
    return {
      providerItemKey: String(item.catalog_object_id || item.sku || item.uid || ''),
      itemLabel: label,
      sku: String(item.sku || ''),
      barcode: String(item.upc || item.barcode || ''),
      quantity: Number(item.quantity) || 0,
    };
  });
  const total = order.total_money || order.totalMoney || null;
  return {
    externalSaleId,
    soldAt: order.created_at || order.createdAt || null,
    locationLabel: '',
    totalAmount: total && total.amount != null ? Number(total.amount) / 100 : null,
    totalCurrency: total?.currency || '',
    summary: `Square order ${externalSaleId}`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// OAuth callback — GET /api/pos/square/callback?code&state.
// The state carries the HMAC-signed business id (see signSquareState),
// so a callback can only ever land on the business that started it.
// Success and failure both bounce back to the Till Connections page
// with a plain flag in the query string.
// ---------------------------------------------------------------------------

export async function squareOAuthCallbackHandler(req, res) {
  const fail = () => res.redirect('/pos?square=failed');
  const pool = getPool();
  if (!pool) return fail();
  const businessId = verifySquareState(req.query?.state);
  if (!businessId || !req.query?.code) return fail();
  try {
    const { rows: businessRows } = await pool.query('SELECT id FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
    if (!businessRows[0]) return fail();
    // Plan gate (Nov 13, 2026): a connection cannot be completed
    // for a business that is not on Business — e.g. the plan
    // changed while the owner was away approving at Square.
    if ((await planFor(pool, businessId)) !== 'business') return fail();
    const tokens = await exchangeSquareCode(String(req.query.code));
    // One Square account, one subscriber: if this merchant was
    // connected to another workspace, that connection ends here —
    // webhooks find their business by merchant id.
    if (tokens.merchant_id) {
      await pool.query(
        "UPDATE pos_connections SET status = 'not_connected', credentials = '', updated_at = NOW() WHERE provider = 'square' AND provider_account_id = $1 AND business_id <> $2",
        [String(tokens.merchant_id), businessId],
      );
    }
    const credentials = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      expires_at: tokens.expires_at || '',
    });
    const existing = await pool.query(
      "SELECT id FROM pos_connections WHERE business_id = $1 AND provider = 'square' LIMIT 1",
      [businessId],
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE pos_connections
            SET status = 'connected', provider_account_id = $1, credentials = $2,
                last_error = '', updated_at = NOW()
          WHERE id = $3`,
        [String(tokens.merchant_id || ''), credentials, existing.rows[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO pos_connections (id, business_id, provider, status, provider_account_id, credentials)
         VALUES ($1, $2, 'square', 'connected', $3, $4)`,
        [crypto.randomUUID(), businessId, String(tokens.merchant_id || ''), credentials],
      );
    }
    return res.redirect('/pos?square=connected');
  } catch (error) {
    console.error('[twin] Square OAuth callback failed:', error?.message || error);
    return fail();
  }
}

// ---------------------------------------------------------------------------
// Webhook — POST /webhooks/pos/square (express.raw, raw body kept).
// ---------------------------------------------------------------------------

export async function squareWebhookHandler(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const cfg = squareConfig();
  if (!cfg.webhookConfigured) {
    return res.status(503).json({ error: 'pos_not_configured', message: 'The Square webhook is not configured yet.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const url = cfg.webhookUrl || `${req.protocol}://${req.get('host')}/webhooks/pos/square`;
  const check = verifySquareSignature(rawBody, req.get('x-square-hmacsha256-signature'), url, cfg.signatureKey);
  if (!check.ok) {
    console.error(`[twin] Square webhook rejected (${check.reason}) — never 200 for an unverified event.`);
    return res.status(400).json({ error: 'invalid_signature', reason: check.reason });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  const type = String(event?.type || '');
  if (type.startsWith('payment.')) {
    // A payment carries no line items — the order event moves the stock.
    return res.json({ received: true, recorded: false, reason: 'payment events carry no line items' });
  }
  if (!type.startsWith('order.')) {
    return res.json({ received: true, recorded: false, reason: 'not a sale event' });
  }
  const object = event?.data?.object || {};
  const order = object.order_created || object.order_updated || object.order || null;
  const sale = normalizeSquareOrder(order);
  if (!sale) {
    return res.status(400).json({ error: 'invalid_payload', message: 'The order event has no order id.' });
  }
  const merchantId = String(event?.merchant_id || '');
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE provider = 'square' AND provider_account_id = $1 AND status = 'connected' LIMIT 1",
    [merchantId],
  );
  const connection = rows[0];
  if (!connection) {
    return res.status(404).json({ error: 'connection_not_found', message: 'No connected business matches this Square account.' });
  }
  // Plan gate (owner's ruling, Nov 13, 2026): till connections are
  // Business only. A sale that arrives while the business is off
  // Business is still ACCEPTED (2xx — no provider retry storm) and
  // recorded HELD FOR PLAN: never lost, never applied, until the
  // business is on Business again and applies it from the app.
  const planKey = await planFor(pool, connection.business_id);
  // Subscription gate (2026-11-13): the same hold covers a workspace
  // whose subscription is not currently access-granting (lapsed,
  // canceled, never paid) — the sale is kept, never applied for free.
  const entitled = await hasFullSubscriptionAccess(pool, connection.business_id);
  const result = await applyPosSale(pool, {
    businessId: connection.business_id,
    connection,
    provider: 'square',
    source: 'webhook',
    sale,
    planKey,
    holdForPlan: planKey !== 'business' || !entitled,
  });
  return res.json({ received: true, duplicate: result.duplicate, status: result.event.status });
}

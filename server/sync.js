/**
 * Offline-first sync — T6 (the core of the phase).
 *
 * The rule, in her words: a staff member in an aisle on their phone
 * scans products in and out, does inventory, removes a damaged item,
 * while the manager watches live on the desktop. If the Wi-Fi or the
 * power falls, sync must NOT break.
 *
 * How it holds:
 *   1. The phone saves every change on the device FIRST (the offline
 *      queue, src/lib/offlineQueue.js) and only then tries to send it.
 *   2. Delivery confirmation: a queued change stays queued until the
 *      server CONFIRMS it received and applied it. No "send and hope".
 *   3. Idempotency: every queued change carries a client-generated
 *      UUID (idempotency_key). The server records applied keys in
 *      `sync_changes` and a replay returns the stored result instead
 *      of applying twice — so a retry can never double-count stock.
 *   4. Convergence: GET /sync/state returns a version built from the
 *      real server state (movement count + newest update). The client
 *      compares it on reconnect and re-reads when it differs, so both
 *      sides end up on the same page.
 *   5. No re-scanning: work done offline counts. A change that was
 *      applied once is never asked for again.
 *
 * Live updates while connected are polling with the last-seen version
 * (useOfflineSync polls /sync/state): the simpler robust choice — no
 * long-lived connection to drop, no reconnect state machine, and a
 * missed poll is just a late refresh, never lost work. Device-to-
 * device live Bluetooth is a NATIVE mobile-app feature, NOT the
 * website — it is deliberately not built here.
 *
 * One failed change never blocks the rest of the batch: changes are
 * applied in order, each in its own transaction, and the response
 * carries a per-change result. A change that fails validation is NOT
 * recorded as applied, so a later retry (when the stock is there) can
 * still apply it; the client decides when a validation failure is
 * permanent and stops retrying it.
 */
import crypto from 'node:crypto';
import {
  recordMovementTx,
  setReservedTx,
  withTx,
  MOVEMENT_TYPES,
} from './movements.js';
import { planFor } from './plans.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

const SYNC_KINDS = ['movement', 'reserve'];

function cleanKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 128) return null;
  return key;
}

async function loadProductInBusiness(client, businessId, productId) {
  const { rows } = await client.query(
    'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
    [productId, businessId],
  );
  return rows[0] ?? null;
}

async function loadLocationInBusiness(client, businessId, locationId) {
  const { rows } = await client.query(
    'SELECT * FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1',
    [locationId, businessId],
  );
  return rows[0] ?? null;
}

/**
 * Apply ONE queued change inside its own transaction: dedupe-check
 * first, then the stock write, then the ledger row — all or nothing.
 * Returns { status, ...result } where status is 'applied',
 * 'duplicate' or 'failed'.
 */
async function applyOneChange(pool, { businessId, user, change }) {
  const key = cleanKey(change?.idempotency_key);
  if (!key) return { status: 'failed', error: 'invalid_key', message: 'Each queued change needs its own id.' };
  if (!SYNC_KINDS.includes(change?.kind)) {
    return { status: 'failed', error: 'invalid_kind', message: `Unknown queued change ${String(change?.kind || '')}.` };
  }
  const payload = change?.payload && typeof change.payload === 'object' ? change.payload : null;
  if (!payload) return { status: 'failed', error: 'invalid_payload', message: 'A queued change needs its details.' };

  return withTx(pool, async (client) => {
    const existing = await client.query(
      'SELECT result FROM sync_changes WHERE business_id = $1 AND idempotency_key = $2 LIMIT 1',
      [businessId, key],
    );
    if (existing.rows[0]) {
      // Already applied — return what happened the first time, apply nothing.
      return { status: 'duplicate', ...JSON.parse(existing.rows[0].result || '{}') };
    }

    const product = await loadProductInBusiness(client, businessId, payload.product_id);
    if (!product) throw err(400, 'invalid_reference', 'The product must belong to this business.');
    const location = await loadLocationInBusiness(client, businessId, payload.location_id);
    if (!location) throw err(400, 'invalid_reference', 'The location must belong to this business.');
    const planKey = await planFor(client, businessId);

    let result;
    if (change.kind === 'reserve') {
      const applied = await setReservedTx(client, {
        businessId,
        product,
        location,
        type: payload.type,
        quantity: payload.quantity,
        note: payload.note || '',
        reference: payload.reference || '',
        userName: user?.email || '',
        caller: user,
      });
      result = { previous: applied.previous, next: applied.next, movement_id: applied.movement?.id ?? null };
    } else {
      let toLocation = null;
      if (payload.to_location_id) {
        toLocation = await loadLocationInBusiness(client, businessId, payload.to_location_id);
        if (!toLocation) throw err(400, 'invalid_reference', 'The destination location must belong to this business.');
      }
      const applied = await recordMovementTx(client, {
        businessId,
        product,
        location,
        type: payload.type,
        quantity: payload.quantity,
        note: payload.note || '',
        scannedCode: payload.scanned_code || '',
        toLocation,
        userName: user?.email || '',
        reference: payload.reference || '',
        supplierName: payload.supplier_name || '',
        unitCost: payload.unit_cost ?? 0,
        planKey,
        caller: user,
      });
      result = { previous: applied.previous, next: applied.next, movement_id: applied.movement?.id ?? null };
    }

    await client.query(
      `INSERT INTO sync_changes (id, business_id, idempotency_key, kind, payload, result, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [crypto.randomUUID(), businessId, key, change.kind, JSON.stringify(payload), JSON.stringify(result), user?.id ?? null],
    );
    return { status: 'applied', idempotency_key: key, ...result };
  }).catch((error) => {
    // A validation failure (not enough stock, unknown type, wrong
    // business) is a per-change failure, not a server crash — and it
    // is NOT recorded, so the phone keeps the change and a later retry
    // can still apply it. A duplicate check above already returned.
    if (error?.status) return { status: 'failed', idempotency_key: key, error: error.code || 'error', message: error.message };
    throw error;
  });
}

/**
 * Apply a batch of queued changes, in the order the phone sends them.
 * The batch result carries one entry per change, in the same order.
 */
export async function applySyncBatch(pool, { businessId, user, changes }) {
  const list = Array.isArray(changes) ? changes.slice(0, 100) : [];
  const results = [];
  for (const change of list) {
    results.push(await applyOneChange(pool, { businessId, user, change }));
  }
  const state = await syncState(pool, businessId);
  return { results, state };
}

/**
 * Convergence state: a version built from the real server state, so
 * the manager's view can re-check against it on reconnect. The
 * version changes whenever a movement lands or a level/product is
 * touched — a client that sees a different version knows to re-read.
 */
export async function syncState(pool, businessId) {
  const [{ rows: movementRows }, { rows: levelRows }, { rows: productRows }] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n, MAX(updated_at) AS newest FROM stock_movements WHERE business_id = $1`,
      [businessId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n, MAX(updated_at) AS newest FROM stock_levels WHERE business_id = $1`,
      [businessId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n, MAX(updated_at) AS newest FROM products WHERE business_id = $1`,
      [businessId],
    ),
  ]);
  const newest = [movementRows[0]?.newest, levelRows[0]?.newest, productRows[0]?.newest]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .sort((a, b) => b - a)[0];
  const movements = movementRows[0]?.n ?? 0;
  const updatedAt = newest ? new Date(newest).toISOString() : null;
  return {
    // movements + newest update: any applied change moves this.
    version: `${movements}-${newest ?? 0}`,
    movements,
    levels: levelRows[0]?.n ?? 0,
    products: productRows[0]?.n ?? 0,
    updated_at: updatedAt,
  };
}

export { MOVEMENT_TYPES };

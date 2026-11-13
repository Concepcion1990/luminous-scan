/**
 * T6 test helpers — builds on tests/t5/helpers.js (real Express app
 * over HTTP against pg-mem, same SQL as production). Adds sync
 * helpers: applying queued changes, reading the convergence state,
 * and cross-store calls.
 */
export * from '../t5/helpers.js';
import crypto from 'node:crypto';
import { base, pool, req } from '../t2/helpers.js';

export { base, pool, req };

/** Apply queued changes through the sync endpoint (idempotent). */
export async function applySync(cookie, businessId, changes) {
  return req(`/api/businesses/${businessId}/sync/apply`, {
    method: 'POST',
    body: { changes },
    cookie,
  });
}

/** Read the convergence state for a business. */
export async function syncState(cookie, businessId) {
  return req(`/api/businesses/${businessId}/sync/state`, { cookie });
}

/** One queued movement change, with a fresh idempotency key. */
export function queuedMovement(productId, locationId, type, quantity, extra = {}) {
  return {
    idempotency_key: crypto.randomUUID(),
    kind: 'movement',
    payload: { product_id: productId, location_id: locationId, type, quantity, ...extra },
  };
}

export function queuedReserve(productId, locationId, type, quantity, extra = {}) {
  return {
    idempotency_key: crypto.randomUUID(),
    kind: 'reserve',
    payload: { product_id: productId, location_id: locationId, type, quantity, ...extra },
  };
}

/**
 * T3 test helpers — builds on tests/t2/helpers.js (real Express app
 * over HTTP against pg-mem, same SQL as production, in-memory mail
 * sink). Adds shop conveniences: business creation, plan setting
 * (direct SQL — no HTTP grant route exists in T3), and raw fetch for
 * binary export downloads.
 */
import crypto from 'node:crypto';

export * from '../t2/helpers.js';
import { base, pool, req, registerVerifiedUser } from '../t2/helpers.js';

export { base, pool, req, registerVerifiedUser };

/** Create a business as the caller; returns the business row. */
export async function createBusiness(cookie, name = 'Test Shop') {
  const res = await req('/api/businesses', { method: 'POST', body: { name }, cookie });
  if (res.status !== 201) throw new Error(`create business failed: ${res.status} ${res.text}`);
  return res.json;
}

/**
 * Set a business's plan by direct SQL (test-only: T3 has no HTTP
 * grant route, and T4 owns billing — tests must not be able to grant
 * a plan through the API).
 */
export async function setPlan(businessId, plan, ownerId = null) {
  const id = crypto.randomUUID();
  await pool.query('DELETE FROM entitlements WHERE business_id = $1', [businessId]);
  await pool.query(
    `INSERT INTO entitlements (id, business_id, plan, status, created_by_id)
     VALUES ($1, $2, $3, 'active', $4)`,
    [id, businessId, plan, ownerId],
  );
}

/**
 * Set a business's entitlement row directly (test-only), with any
 * status/dates — the general form of setPlan. The HTTP grant flow is
 * T4's; tests write the row by SQL, like setPlan always did.
 */
export async function setEntitlement(businessId, { plan = 'essentials', status = 'active', trialEndsAt = null, periodEndsAt = null, ownerId = null } = {}) {
  await pool.query('DELETE FROM entitlements WHERE business_id = $1', [businessId]);
  await pool.query(
    `INSERT INTO entitlements (id, business_id, plan, status, trial_ends_at, period_ends_at, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), businessId, plan, status, trialEndsAt, periodEndsAt, ownerId],
  );
}

/**
 * Owner + one business. Since the 2026-11-13 access gate, a business
 * with no entitlement row serves NO business data, so a fixture that
 * exercises feature behavior grants an active Essentials entitlement
 * by default — the state a real workspace is in after checkout.
 * Pass { grant: false } for the unpaid-workspace cases, or
 * { plan: 'business' } for an entitled Business workspace.
 */
export async function ownerWithBusiness(email, name = 'Test Shop', { grant = true, plan = 'essentials' } = {}) {
  const owner = await registerVerifiedUser(email);
  const business = await createBusiness(owner.cookie, name);
  if (grant) await setPlan(business.id, plan, owner.user.id);
  return { ...owner, business };
}

/** Create a location as the caller. */
export async function createLocation(cookie, businessId, values = {}) {
  const res = await req(`/api/businesses/${businessId}/locations`, {
    method: 'POST',
    body: { location: { name: 'Main store', kind: 'store', ...values } },
    cookie,
  });
  if (res.status !== 201) throw new Error(`create location failed: ${res.status} ${res.text}`);
  return res.json.location;
}

/** Create products via the create-products function route. */
export async function createProducts(cookie, businessId, products) {
  const res = await req(`/api/businesses/${businessId}/products`, {
    method: 'POST',
    body: { business_id: businessId, products },
    cookie,
  });
  if (res.status !== 201) throw new Error(`create products failed: ${res.status} ${res.text}`);
  return res.json.created;
}

/** Raw fetch (binary-safe) for export downloads. */
export async function reqRaw(path, { method = 'GET', cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { method, headers });
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    headers: res.headers,
    buffer,
    text: buffer.toString('utf8'),
  };
}

/** Receive stock through the atomic movements endpoint. */
export async function receive(cookie, businessId, productId, locationId, quantity) {
  const res = await req(`/api/businesses/${businessId}/movements`, {
    method: 'POST',
    body: { product_id: productId, location_id: locationId, type: 'receive', quantity },
    cookie,
  });
  if (res.status !== 201) throw new Error(`receive failed: ${res.status} ${res.text}`);
  return res.json;
}

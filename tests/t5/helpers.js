/**
 * T5 test helpers — builds on tests/t3/helpers.js (real Express app
 * over HTTP against pg-mem, same SQL as production). Adds Business
 * fixtures: suppliers, purchase orders, BOMs, and stock helpers.
 */
import crypto from 'node:crypto';

export * from '../t3/helpers.js';
import { base, pool, req, registerVerifiedUser } from '../t2/helpers.js';

export { base, pool, req, registerVerifiedUser };

/** Create a supplier as the caller (Business only). */
export async function createSupplier(cookie, businessId, values = {}) {
  const res = await req('/api/entities/Supplier', {
    method: 'POST',
    body: { business_id: businessId, name: 'Test Supplier', ...values },
    cookie,
  });
  if (res.status !== 201) throw new Error(`create supplier failed: ${res.status} ${res.text}`);
  return res.json;
}

/** Create a purchase order as the caller; returns the created row. */
export async function createPO(cookie, businessId, values = {}) {
  const res = await req('/api/entities/PurchaseOrder', {
    method: 'POST',
    body: { business_id: businessId, number: `PO-${crypto.randomBytes(3).toString('hex')}`, ...values },
    cookie,
  });
  if (res.status !== 201) throw new Error(`create PO failed: ${res.status} ${res.text}`);
  return res.json;
}

/** Create a BOM as the caller; returns the created row. */
export async function createBom(cookie, businessId, values = {}) {
  const res = await req('/api/entities/Bom', {
    method: 'POST',
    body: { business_id: businessId, kind: 'bundle', ...values },
    cookie,
  });
  if (res.status !== 201) throw new Error(`create BOM failed: ${res.status} ${res.text}`);
  return res.json;
}

/** Current on-hand quantity of a product at a location (0 when no level row). */
export async function onHand(businessId, productId, locationId) {
  const { rows } = await pool.query(
    'SELECT quantity FROM stock_levels WHERE business_id = $1 AND product_id = $2 AND location_id = $3 LIMIT 1',
    [businessId, productId, locationId],
  );
  return Number(rows[0]?.quantity ?? 0);
}

/** Put a business into grace (canceled, paid period ended yesterday). */
export async function enterGrace(businessId) {
  const pastPeriodEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    "UPDATE entitlements SET status = 'canceled', period_ends_at = $1 WHERE business_id = $2",
    [pastPeriodEnd, businessId],
  );
}

/** Assert a response body is a real PDF mentioning the given strings. */
export function assertPdf(buffer, strings = []) {
  const text = Buffer.from(buffer).toString('latin1');
  if (!text.startsWith('%PDF-')) throw new Error('response is not a PDF');
  if (buffer.length < 500) throw new Error(`PDF too small: ${buffer.length} bytes`);
  for (const needle of strings) {
    if (!text.includes(needle)) throw new Error(`PDF is missing expected text: ${needle}`);
  }
  return text;
}

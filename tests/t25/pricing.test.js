/**
 * T25 — Clearance + rollback pricing (Business-only, Nov 13, 2026).
 *
 * The owner's design, pinned:
 *  - CLEARANCE is a permanent markdown; ROLLBACK is a dated sale whose
 *    regular price is retained and whose effective price returns to
 *    regular by itself after the end date (derived, never jobbed).
 *  - Writes that ACTIVATE pricing off-Business are refused with
 *    403 pricing_business_only (create and update alike).
 *  - Reads off-Business arrive stripped to the pricing defaults —
 *    the POS-gate pattern: the data is HELD, not lost, and comes
 *    back untouched when the business returns to Business.
 *  - priceInfo derives the effective price from the calendar window.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { ownerWithBusiness, setPlan, req, close } from './helpers.js';

after(close);
import { priceInfo, effectivePrice } from '../../src/lib/pricing.js';

async function createProduct(cookie, businessId, values) {
  return req('/api/entities/Product', {
    method: 'POST',
    cookie,
    body: { business_id: businessId, name: 'Widget', sku: `W-${Math.random().toString(36).slice(2, 8)}`, price: 20, ...values },
  });
}

test('pricing: Essentials cannot create a product with pricing active', async () => {
  const { cookie, business } = await ownerWithBusiness('t25-ess-create@example.com');
  const res = await createProduct(cookie, business.id, { pricing_mode: 'clearance', clearance_price: 12 });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'pricing_business_only');
});

test('pricing: Essentials cannot switch pricing on by update, but plain edits pass', async () => {
  const { cookie, business } = await ownerWithBusiness('t25-ess-update@example.com');
  const created = await createProduct(cookie, business.id, {});
  assert.equal(created.status, 201);
  const id = created.json.id;

  const plain = await req(`/api/entities/Product/${id}`, { method: 'PATCH', cookie, body: { name: 'Renamed widget' } });
  assert.equal(plain.status, 200);
  assert.equal(plain.json.pricing_mode, 'regular');

  const gated = await req(`/api/entities/Product/${id}`, {
    method: 'PATCH',
    cookie,
    body: { pricing_mode: 'rollback', sale_price: 15, sale_start: '2026-11-01', sale_end: '2026-11-30' },
  });
  assert.equal(gated.status, 403);
  assert.equal(gated.json.error, 'pricing_business_only');
});

test('pricing: Business can set clearance and rollback, fields persist', async () => {
  const { cookie, business } = await ownerWithBusiness('t25-biz@example.com', 'Biz Shop', { plan: 'business' });
  const created = await createProduct(cookie, business.id, { pricing_mode: 'clearance', clearance_price: 12.5 });
  assert.equal(created.status, 201);
  assert.equal(created.json.pricing_mode, 'clearance');
  assert.equal(Number(created.json.clearance_price), 12.5);

  const updated = await req(`/api/entities/Product/${created.json.id}`, {
    method: 'PATCH',
    cookie,
    body: { pricing_mode: 'rollback', sale_price: 15, sale_start: '2026-11-10', sale_end: '2026-11-20' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.pricing_mode, 'rollback');
  assert.equal(Number(updated.json.sale_price), 15);
  assert.equal(updated.json.sale_start, '2026-11-10');
  assert.equal(updated.json.sale_end, '2026-11-20');
  // The regular price is retained untouched the whole time.
  assert.equal(Number(updated.json.price), 20);
});

test('pricing: downgrade holds the data — reads strip to defaults, upgrade restores', async () => {
  const { cookie, business } = await ownerWithBusiness('t25-hold@example.com', 'Hold Shop', { plan: 'business' });
  const created = await createProduct(cookie, business.id, {
    pricing_mode: 'rollback', sale_price: 9.99, sale_start: '2026-11-01', sale_end: '2026-12-01',
  });
  assert.equal(created.status, 201);
  const id = created.json.id;

  await setPlan(business.id, 'essentials');
  const listed = await req('/api/entities/Product/query', {
    method: 'POST', cookie, body: { filter: { business_id: business.id } },
  });
  assert.equal(listed.status, 200);
  const row = listed.json.items.find((p) => p.id === id);
  assert.ok(row, 'product still listed off-Business');
  assert.equal(row.pricing_mode, 'regular');
  assert.equal(row.sale_price, null);
  assert.equal(row.clearance_price, null);
  assert.equal(row.sale_start, null);
  assert.equal(row.sale_end, null);

  const got = await req(`/api/entities/Product/${id}`, { cookie });
  assert.equal(got.status, 200);
  assert.equal(got.json.pricing_mode, 'regular');

  await setPlan(business.id, 'business');
  const back = await req(`/api/entities/Product/${id}`, { cookie });
  assert.equal(back.status, 200);
  assert.equal(back.json.pricing_mode, 'rollback');
  assert.equal(Number(back.json.sale_price), 9.99);
  assert.equal(back.json.sale_start, '2026-11-01');
  assert.equal(back.json.sale_end, '2026-12-01');
});

test('pricing: priceInfo derives the effective price from the window', () => {
  const at = (iso) => new Date(`${iso}T12:00:00`);

  // Regular product: nothing to derive.
  assert.deepEqual(priceInfo({ price: 20 }, at('2026-11-13')),
    { mode: 'regular', effective: 20, regular: 20, onSale: false, active: false, start: null, end: null });

  // Clearance is permanent — same effective price on any date.
  const clearance = { price: 20, pricing_mode: 'clearance', clearance_price: 12 };
  assert.equal(effectivePrice(clearance, at('2026-01-01')), 12);
  assert.equal(effectivePrice(clearance, at('2027-06-30')), 12);
  assert.equal(priceInfo(clearance, at('2026-11-13')).onSale, true);

  // Rollback window: before, during, after.
  const rollback = {
    price: 20, pricing_mode: 'rollback', sale_price: 15, sale_start: '2026-11-10', sale_end: '2026-11-20',
  };
  const before = priceInfo(rollback, at('2026-11-09'));
  assert.equal(before.effective, 20);
  assert.equal(before.active, false);
  assert.equal(before.onSale, false);
  const during = priceInfo(rollback, at('2026-11-13'));
  assert.equal(during.effective, 15);
  assert.equal(during.active, true);
  assert.equal(during.onSale, true);
  assert.equal(during.regular, 20);
  const lastDay = priceInfo(rollback, at('2026-11-20'));
  assert.equal(lastDay.effective, 15, 'the end date itself is still a sale day');
  const after = priceInfo(rollback, at('2026-11-21'));
  assert.equal(after.effective, 20, 'the price returns to regular on its own');
  assert.equal(after.active, false);

  // Open bounds: no start = already running; no end = runs until changed.
  assert.equal(effectivePrice({ price: 20, pricing_mode: 'rollback', sale_price: 15, sale_end: '2026-11-20' }, at('2026-01-01')), 15);
  assert.equal(effectivePrice({ price: 20, pricing_mode: 'rollback', sale_price: 15, sale_start: '2026-11-10' }, at('2027-01-01')), 15);

  // A rollback mode with no sale price set falls back to regular.
  assert.equal(effectivePrice({ price: 20, pricing_mode: 'rollback' }, at('2026-11-13')), 20);
});

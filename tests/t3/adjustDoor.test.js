/**
 * T3 — The Adjust door's permission (owner catch, Nov 19, 2026).
 *
 * The owner, testing by hand as a Sales clerk (products.view +
 * scan.use, NO products.edit), found the product EDIT form refused
 * her save — "You do not have permission to do that here." — while
 * the row Adjust sheet let her Add / Remove / Set counts anyway:
 * the sheet rode the generic movement funnel, whose only gate is
 * scan.use, the scanner workstation's permission.
 *
 * The fix: the catalog lists' stock doors (Adjust sheet, Products
 * row stepper, Add stock) write through POST /stock-adjustments,
 * which requires products.edit — the same permission the product
 * form enforces — and the UI doors hide without it. The scanner
 * keeps its own door: /movements still asks only for scan.use, so
 * a sales clerk can still record a sale at the scanner, exactly
 * as the role intends. These tests pin both directions.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  seededLocation,
  createProducts,
  receive,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function setup(email) {
  const owner = await ownerWithBusiness(email);
  const location = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Deck of Cards', sku: 'DC-1', price: 2.5, cost: 1, reorder_point: 2 },
  ]);
  return { ...owner, location, product };
}

/** Invite a member with a preset role, activate their account, and
 * give them a full-week schedule so the shift window lets their
 * session work (the window brackets sign-in once the active
 * business is set — owner ruling, Nov 19, 2026). */
async function actor(owner, { email, roleId, roleName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: owner['cookie'],
    body: {
      business_id: owner.business.id,
      full_name: roleName,
      email,
      role_id: roleId,
      role_name: roleName,
    },
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    owner.business.id,
    account.user.id,
  ]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      email,
    ])
  ).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  return account;
}

async function level(cookie, businessId, productId, locationId) {
  const res = await req('/api/entities/StockLevel/query', {
    method: 'POST',
    body: { filter: { business_id: businessId } },
    cookie,
  });
  assert.equal(res.status, 200, res.text);
  const row = res.json.items.find(
    (l) => l.product_id === productId && l.location_id === locationId,
  );
  return row?.quantity ?? 0;
}

async function adjust(cookie, businessId, body) {
  return req(`/api/businesses/${businessId}/stock-adjustments`, {
    method: 'POST',
    body,
    cookie,
  });
}

test('a sales clerk (scan.use, no products.edit) is refused at the adjust door — and the count does not move', async () => {
  const ctx = await setup('adjust-sales-owner@example.com');
  const sales = await actor(ctx, {
    email: 'adjust-sales@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });

  for (const body of [
    { type: 'receive', quantity: 3 },
    { type: 'sale', quantity: 1 },
    { type: 'count', quantity: 9 },
    { type: 'correction', quantity: 9 },
  ]) {
    const res = await adjust(sales.cookie, ctx.business.id, {
      product_id: ctx.product.id,
      location_id: ctx.location.id,
      ...body,
    });
    assert.equal(res.status, 403, `${body.type} should refuse: ${res.text}`);
    assert.equal(res.json.error, 'forbidden');
    assert.equal(res.json.message, 'You do not have permission to do that here.');
  }
  assert.equal(await level(ctx.cookie, ctx.business.id, ctx.product.id, ctx.location.id), 0);

  // The scanner door is hers by design and stays open: the same
  // receive through /movements succeeds.
  const scanned = await receive(sales.cookie, ctx.business.id, ctx.product.id, ctx.location.id, 4);
  assert.equal(scanned.next, 4, 'the scanner movement still records for a sales clerk');
});

test('a stock clerk (products.edit) adjusts exactly as before: receive, set, sale, correction', async () => {
  const ctx = await setup('adjust-stock-owner@example.com');
  const stock = await actor(ctx, {
    email: 'adjust-stock@example.com',
    roleId: 'preset-stock',
    roleName: 'Stock clerk',
  });
  const at = { product_id: ctx.product.id, location_id: ctx.location.id };

  const added = await adjust(stock.cookie, ctx.business.id, { ...at, type: 'receive', quantity: 5 });
  assert.equal(added.status, 201, added.text);
  assert.equal(added.json.next, 5);

  const set = await adjust(stock.cookie, ctx.business.id, { ...at, type: 'count', quantity: 2 });
  assert.equal(set.status, 201, set.text);
  assert.equal(set.json.next, 2);

  const sold = await adjust(stock.cookie, ctx.business.id, { ...at, type: 'sale', quantity: 1 });
  assert.equal(sold.status, 201, sold.text);
  assert.equal(sold.json.next, 1);

  const corrected = await adjust(stock.cookie, ctx.business.id, { ...at, type: 'correction', quantity: 7 });
  assert.equal(corrected.status, 201, corrected.text);
  assert.equal(corrected.json.next, 7);
  assert.equal(await level(ctx.cookie, ctx.business.id, ctx.product.id, ctx.location.id), 7);
});

test('the owner adjusts; the adjust door refuses non-adjustment types even for the owner', async () => {
  const ctx = await setup('adjust-owner@example.com');
  const at = { product_id: ctx.product.id, location_id: ctx.location.id };

  const added = await adjust(ctx.cookie, ctx.business.id, { ...at, type: 'receive', quantity: 3 });
  assert.equal(added.status, 201, added.text);
  assert.equal(added.json.next, 3);

  const transfer = await adjust(ctx.cookie, ctx.business.id, { ...at, type: 'transfer', quantity: 1 });
  assert.equal(transfer.status, 400, transfer.text);
  assert.equal(transfer.json.error, 'invalid_type');
  assert.equal(await level(ctx.cookie, ctx.business.id, ctx.product.id, ctx.location.id), 3);
});

test('a viewer (products.view only) is refused at both stock doors', async () => {
  const ctx = await setup('adjust-viewer-owner@example.com');
  const viewer = await actor(ctx, {
    email: 'adjust-viewer@example.com',
    roleId: 'preset-viewer',
    roleName: 'Viewer',
  });
  const at = { product_id: ctx.product.id, location_id: ctx.location.id };

  const viaAdjust = await adjust(viewer.cookie, ctx.business.id, { ...at, type: 'receive', quantity: 1 });
  assert.equal(viaAdjust.status, 403, viaAdjust.text);

  const viaMovement = await req(`/api/businesses/${ctx.business.id}/movements`, {
    method: 'POST',
    cookie: viewer['cookie'],
    body: { ...at, type: 'receive', quantity: 1 },
  });
  assert.equal(viaMovement.status, 403, viaMovement.text);
  assert.equal(await level(ctx.cookie, ctx.business.id, ctx.product.id, ctx.location.id), 0);
});

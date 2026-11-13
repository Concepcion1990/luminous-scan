/**
 * T5 — BOMs, builds, disassembly (plan §2.11).
 *
 * Consume components → produce bundle, disassembly returns parts,
 * never-negative components, bundle movement types gated on
 * Essentials. All stock changes run in one transaction.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  req,
  pool,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
  createBom,
  receive,
  onHand,
} from './helpers.js';

after(close);

async function businessSetup(email, plan = 'business') {
  const owner = await ownerWithBusiness(email);
  await setPlan(owner.business.id, plan, owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id);
  const [compA, compB, finished] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Bookmark A', sku: 'BM-A', cost: 2, price: 9 },
    { name: 'Notepad B', sku: 'NB-B', cost: 3, price: 9 },
    { name: 'Gift Bundle', sku: 'GB-001', cost: 0, price: 25 },
  ]);
  await receive(owner.cookie, owner.business.id, compA.id, location.id, 10);
  await receive(owner.cookie, owner.business.id, compB.id, location.id, 10);
  return { owner, location, compA, compB, finished };
}

async function movementsOf(businessId, productId) {
  const { rows } = await pool.query(
    'SELECT type, quantity FROM stock_movements WHERE business_id = $1 AND product_id = $2 ORDER BY created_at ASC',
    [businessId, productId],
  );
  return rows;
}

test('a BOM build consumes components and produces the bundle', async () => {
  const { owner, location, compA, compB, finished } = await businessSetup('bom-build@example.com');
  const bom = await createBom(owner.cookie, owner.business.id, {
    product_id: finished.id,
    product_name: finished.name,
    sku: finished.sku,
    lines: [
      { component_id: compA.id, component_name: compA.name, sku: compA.sku, quantity: 2 },
      { component_id: compB.id, component_name: compB.name, sku: compB.sku, quantity: 1 },
    ],
  });
  const built = await req(`/api/businesses/${owner.business.id}/boms/${bom.id}/build`, {
    method: 'POST',
    body: { location_id: location.id, quantity: 3 },
    cookie: owner.cookie,
  });
  assert.equal(built.status, 200);
  assert.match(built.json.reference, /^BUILD-/);
  assert.equal(built.json.quantity, 3);
  assert.equal(built.json.next, 3);
  assert.equal(await onHand(owner.business.id, compA.id, location.id), 4);
  assert.equal(await onHand(owner.business.id, compB.id, location.id), 7);
  assert.equal(await onHand(owner.business.id, finished.id, location.id), 3);
  const compMoves = await movementsOf(owner.business.id, compA.id);
  assert.ok(compMoves.some((m) => m.type === 'consume' && Number(m.quantity) === 6));
  const finMoves = await movementsOf(owner.business.id, finished.id);
  assert.ok(finMoves.some((m) => m.type === 'produce' && Number(m.quantity) === 3));
});

test('a build that cannot be filled writes nothing at all', async () => {
  const { owner, location, compA, compB, finished } = await businessSetup('bom-short@example.com');
  const bom = await createBom(owner.cookie, owner.business.id, {
    product_id: finished.id,
    product_name: finished.name,
    sku: finished.sku,
    lines: [
      { component_id: compA.id, component_name: compA.name, sku: compA.sku, quantity: 2 },
      { component_id: compB.id, component_name: compB.name, sku: compB.sku, quantity: 1 },
    ],
  });
  // 6 bundles need 12 of A; only 10 on hand.
  const res = await req(`/api/businesses/${owner.business.id}/boms/${bom.id}/build`, {
    method: 'POST',
    body: { location_id: location.id, quantity: 6 },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'insufficient_stock');
  assert.equal(await onHand(owner.business.id, compA.id, location.id), 10);
  assert.equal(await onHand(owner.business.id, compB.id, location.id), 10);
  assert.equal(await onHand(owner.business.id, finished.id, location.id), 0);
  const finMoves = await movementsOf(owner.business.id, finished.id);
  assert.equal(finMoves.filter((m) => m.type === 'produce').length, 0);
});

test('disassembly takes the bundle apart and returns every component', async () => {
  const { owner, location, compA, compB, finished } = await businessSetup('bom-tear@example.com');
  const bom = await createBom(owner.cookie, owner.business.id, {
    product_id: finished.id,
    product_name: finished.name,
    sku: finished.sku,
    lines: [
      { component_id: compA.id, component_name: compA.name, sku: compA.sku, quantity: 2 },
      { component_id: compB.id, component_name: compB.name, sku: compB.sku, quantity: 1 },
    ],
  });
  await req(`/api/businesses/${owner.business.id}/boms/${bom.id}/build`, {
    method: 'POST',
    body: { location_id: location.id, quantity: 2 },
    cookie: owner.cookie,
  });
  const torn = await req(`/api/businesses/${owner.business.id}/boms/${bom.id}/disassemble`, {
    method: 'POST',
    body: { location_id: location.id, quantity: 1 },
    cookie: owner.cookie,
  });
  assert.equal(torn.status, 200);
  assert.match(torn.json.reference, /^TEARDOWN-/);
  assert.equal(torn.json.remaining, 1);
  assert.equal(await onHand(owner.business.id, finished.id, location.id), 1);
  assert.equal(await onHand(owner.business.id, compA.id, location.id), 8);
  assert.equal(await onHand(owner.business.id, compB.id, location.id), 9);
  const compMoves = await movementsOf(owner.business.id, compA.id);
  assert.ok(compMoves.some((m) => m.type === 'recovered' && Number(m.quantity) === 2));
  // Taking apart more bundles than exist is refused.
  const tooMany = await req(`/api/businesses/${owner.business.id}/boms/${bom.id}/disassemble`, {
    method: 'POST',
    body: { location_id: location.id, quantity: 5 },
    cookie: owner.cookie,
  });
  assert.equal(tooMany.status, 400);
  assert.equal(await onHand(owner.business.id, finished.id, location.id), 1);
});

test('BOM validation refuses bad components and self-reference', async () => {
  const { owner, finished, compA } = await businessSetup('bom-bad@example.com');
  const self = await req('/api/entities/Bom', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      product_id: finished.id,
      kind: 'bundle',
      lines: [{ component_id: finished.id, component_name: finished.name, quantity: 1 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(self.status, 400);
  const ghost = await req('/api/entities/Bom', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      product_id: finished.id,
      kind: 'bundle',
      lines: [{ component_id: 'missing-product', component_name: 'Ghost', quantity: 1 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(ghost.status, 400);
  assert.equal(ghost.json.error, 'invalid_reference');
  const zero = await req('/api/entities/Bom', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      product_id: finished.id,
      kind: 'bundle',
      lines: [{ component_id: compA.id, component_name: compA.name, quantity: 0 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(zero.status, 400);
});

test('bundles are Business-only: BOM writes and bundle movements refuse on Essentials', async () => {
  const { owner, location, compA, compB, finished } = await businessSetup(
    'bom-ess@example.com',
    'essentials',
  );
  const bom = await req('/api/entities/Bom', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      product_id: finished.id,
      kind: 'bundle',
      lines: [{ component_id: compA.id, component_name: compA.name, quantity: 1 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(bom.status, 403);
  assert.equal(bom.json.error, 'plan_gated');
  // Direct bundle movement writes refuse too.
  const move = await req('/api/entities/StockMovement', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      product_id: compA.id,
      type: 'consume',
      quantity: 1,
      location_id: location.id,
    },
    cookie: owner.cookie,
  });
  assert.equal(move.status, 403);
  assert.equal(move.json.error, 'bundle_business_only');
  void compB;
});

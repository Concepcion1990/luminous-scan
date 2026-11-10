/**
 * T6 — offline-first sync (the core of the phase).
 *
 * The acceptance test, from her hard rule: a staff member in an aisle
 * on their phone scans products in/out, does inventory, removes a
 * damaged item, while the manager watches live on the desktop. If the
 * Wi-Fi falls, sync must NOT break: the phone saves every scan on the
 * device first, the server CONFIRMS each change, unconfirmed work
 * retries visibly, and on reconnect both sides converge — with no
 * loss and no duplication.
 *
 * These tests run the REAL server (pg-mem) through HTTP. The client
 * queue itself (enqueue while offline → flush on reconnect) is proven
 * in offlineQueue.test.js with the memory store + a fake transport;
 * together they cover offline → queue → reconnect → converge.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  close,
  req,
  pool,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
  receive,
  onHand,
  enterGrace,
  applySync,
  syncState,
  queuedMovement,
  queuedReserve,
} from './helpers.js';

after(close);

async function stockedSetup(email) {
  const owner = await ownerWithBusiness(email);
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Aisle 1' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Test Notebook', sku: 'SYNC-001', cost: 5, price: 12 },
  ]);
  await receive(owner.cookie, owner.business.id, product.id, location.id, 10);
  return { owner, location, product };
}

test('a queued sale applies once and moves the convergence version', async () => {
  const { owner, location, product } = await stockedSetup('sync-sale@example.com');
  const before = await syncState(owner.cookie, owner.business.id);
  assert.equal(before.status, 200);
  const versionBefore = before.json.version;

  const res = await applySync(owner.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'sale', 2),
  ]);
  assert.equal(res.status, 200);
  assert.equal(res.json.results[0].status, 'applied');
  assert.equal(res.json.results[0].next, 8);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 8);

  const afterState = await syncState(owner.cookie, owner.business.id);
  assert.notEqual(afterState.json.version, versionBefore);
  assert.equal(afterState.json.movements, before.json.movements + 1);
});

test('replaying the same idempotency key never double-counts', async () => {
  const { owner, location, product } = await stockedSetup('sync-replay@example.com');
  const change = queuedMovement(product.id, location.id, 'sale', 2);
  const first = await applySync(owner.cookie, owner.business.id, [change]);
  assert.equal(first.json.results[0].status, 'applied');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 8);

  // Same key, same payload: a duplicate, not a second sale.
  const replay = await applySync(owner.cookie, owner.business.id, [change]);
  assert.equal(replay.json.results[0].status, 'duplicate');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 8);

  // Same key, DIFFERENT payload: still the stored first result — the
  // key is the identity of the change, and it was already applied.
  const tampered = { ...change, payload: { ...change.payload, quantity: 5 } };
  const replay2 = await applySync(owner.cookie, owner.business.id, [tampered]);
  assert.equal(replay2.json.results[0].status, 'duplicate');
  assert.equal(replay2.json.results[0].next, 8);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 8);
});

test('a batch applies in order: damaged removal + receive + count', async () => {
  const { owner, location, product } = await stockedSetup('sync-batch@example.com');
  const res = await applySync(owner.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'damaged', 1, { note: 'Water damage' }),
    queuedMovement(product.id, location.id, 'receive', 5),
    queuedMovement(product.id, location.id, 'count', 12),
  ]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.results.map((r) => r.status), ['applied', 'applied', 'applied']);
  assert.equal(res.json.results[0].next, 9);
  assert.equal(res.json.results[1].next, 14);
  assert.equal(res.json.results[2].next, 12);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 12);
});

test('a failed change applies nothing and can still succeed on retry', async () => {
  const { owner, location, product } = await stockedSetup('sync-fail@example.com');
  const change = queuedMovement(product.id, location.id, 'sale', 99);
  const res = await applySync(owner.cookie, owner.business.id, [change]);
  assert.equal(res.status, 200);
  assert.equal(res.json.results[0].status, 'failed');
  assert.equal(res.json.results[0].error, 'insufficient_stock');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 10);

  // One bad change never blocks the rest of the batch.
  const mixed = await applySync(owner.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'sale', 99),
    queuedMovement(product.id, location.id, 'sale', 2),
  ]);
  assert.deepEqual(mixed.json.results.map((r) => r.status), ['failed', 'applied']);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 8);

  // The failed key was NOT recorded as applied, so a corrected retry
  // of the same change (stock is there now) can still apply it.
  const retry = await applySync(owner.cookie, owner.business.id, [
    { ...change, payload: { ...change.payload, quantity: 1 } },
  ]);
  assert.equal(retry.json.results[0].status, 'applied');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 7);
});

test('a queued hold moves reserved, never on-hand', async () => {
  const { owner, location, product } = await stockedSetup('sync-hold@example.com');
  const res = await applySync(owner.cookie, owner.business.id, [
    queuedReserve(product.id, location.id, 'reserved', 2),
  ]);
  assert.equal(res.json.results[0].status, 'applied');
  assert.equal(res.json.results[0].next, 2);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 10);
  const { rows } = await pool.query(
    'SELECT reserved FROM stock_levels WHERE business_id = $1 AND product_id = $2 AND location_id = $3',
    [owner.business.id, product.id, location.id],
  );
  assert.equal(Number(rows[0]?.reserved ?? 0), 2);
});

test('sync refuses bad keys, unknown kinds, and strangers', async () => {
  const { owner, location, product } = await stockedSetup('sync-guards@example.com');
  const noKey = await applySync(owner.cookie, owner.business.id, [
    { kind: 'movement', payload: { product_id: product.id, location_id: location.id, type: 'sale', quantity: 1 } },
  ]);
  assert.equal(noKey.json.results[0].status, 'failed');
  assert.equal(noKey.json.results[0].error, 'invalid_key');

  const badKind = await applySync(owner.cookie, owner.business.id, [
    { idempotency_key: crypto.randomUUID(), kind: 'teleport', payload: {} },
  ]);
  assert.equal(badKind.json.results[0].status, 'failed');
  assert.equal(badKind.json.results[0].error, 'invalid_kind');

  const stranger = await ownerWithBusiness('sync-stranger@example.com');
  const forbidden = await applySync(stranger.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'sale', 1),
  ]);
  assert.equal(forbidden.status, 403);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 10);

  const signedOut = await applySync(undefined, owner.business.id, [
    queuedMovement(product.id, location.id, 'sale', 1),
  ]);
  assert.equal(signedOut.status, 401);
});

test('sync is blocked in grace (read-only) and the version is stable on replay', async () => {
  const { owner, location, product } = await stockedSetup('sync-grace@example.com');
  const change = queuedMovement(product.id, location.id, 'sale', 1);
  const first = await applySync(owner.cookie, owner.business.id, [change]);
  assert.equal(first.json.results[0].status, 'applied');
  const versionAfterApply = (await syncState(owner.cookie, owner.business.id)).json.version;

  // A replay changes nothing — not the stock, not the version.
  await applySync(owner.cookie, owner.business.id, [change]);
  const versionAfterReplay = (await syncState(owner.cookie, owner.business.id)).json.version;
  assert.equal(versionAfterReplay, versionAfterApply);

  // Grace needs a real entitlement row first: enterGrace only flips
  // the row, and a business with no row has no grace state at all.
  await setPlan(owner.business.id, 'essentials', owner.user.id);
  await enterGrace(owner.business.id);
  const blocked = await applySync(owner.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'sale', 1),
  ]);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, 'grace_read_only');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 9);
});

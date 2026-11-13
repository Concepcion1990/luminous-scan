/**
 * T6 — the client side of offline-first sync: the queue itself.
 *
 * Scenario: the phone is offline. It saves every scan on the device
 * FIRST (the queue), then flushes in order when the connection
 * returns, keeping each change until the server CONFIRMS it. No loss,
 * no duplication, no silent failure — and a change the server already
 * applied is never applied twice.
 *
 * Pure node test: the memory store + an injected fake transport stand
 * in for IndexedDB + the real server (the server side is proven in
 * offlineSync.test.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryQueue, newQueuedChange } from '../../src/lib/offlineQueue.js';
import { flushQueue, discardQueuedChange, SYNC_MAX_ATTEMPTS } from '../../src/lib/syncClient.js';

function movement(productId, quantity) {
  return newQueuedChange('biz-1', 'movement', { product_id: productId, location_id: 'loc-1', type: 'sale', quantity });
}

test('offline work queues, then flushes in order when the connection returns', async () => {
  const queue = createMemoryQueue();
  // The phone is offline: three scans land on the device, in order.
  const sent = [];
  const first = movement('prod-a', 2);
  const second = movement('prod-a', 1);
  const third = movement('prod-b', 3);
  await queue.add(first);
  await queue.add(second);
  await queue.add(third);
  assert.equal((await queue.all()).length, 3);

  // The connection returns: the flush sends them oldest-first.
  const send = async (_path, { body }) => {
    sent.push(...body.changes.map((c) => c.idempotency_key));
    return { results: body.changes.map(() => ({ status: 'applied' })) };
  };
  const summary = await flushQueue(queue, 'biz-1', { send });
  assert.deepEqual(sent, [first.key, second.key, third.key]);
  assert.equal(summary.confirmed, 3);
  assert.equal(summary.stillPending, 0);
  assert.equal((await queue.all()).length, 0);
});

test('a network failure keeps everything queued — nothing is lost', async () => {
  const queue = createMemoryQueue();
  await queue.add(movement('prod-a', 2));
  await queue.add(movement('prod-a', 1));

  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('Failed to fetch');
    return { results: [{ status: 'applied' }, { status: 'applied' }] };
  };
  const first = await flushQueue(queue, 'biz-1', { send: flaky });
  assert.equal(first.stillPending, 2);
  assert.equal(first.confirmed, 0);
  assert.equal((await queue.all()).length, 2);

  // The retry (the phone retries on its own) confirms both.
  const second = await flushQueue(queue, 'biz-1', { send: flaky });
  assert.equal(second.confirmed, 2);
  assert.equal((await queue.all()).length, 0);
});

test('a server-confirmed duplicate is removed, never applied twice', async () => {
  const queue = createMemoryQueue();
  const change = movement('prod-a', 2);
  await queue.add(change);
  const send = async (_path, { body }) => ({
    results: body.changes.map(() => ({ status: 'duplicate', previous: 8, next: 8 })),
  });
  const summary = await flushQueue(queue, 'biz-1', { send });
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.confirmed, 1);
  assert.equal((await queue.all()).length, 0);
});

test('a refused change retries, then stays failed on the device — never dropped silently', async () => {
  const queue = createMemoryQueue();
  await queue.add(movement('prod-a', 99));
  const refusing = async (_path, { body }) => ({
    results: body.changes.map(() => ({ status: 'failed', error: 'insufficient_stock', message: 'Only 10 on hand.' })),
  });
  let summary;
  for (let i = 0; i < SYNC_MAX_ATTEMPTS; i += 1) {
    summary = await flushQueue(queue, 'biz-1', { send: refusing });
  }
  assert.equal(summary.failed, 1);
  const rows = await queue.all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].lastError, /Only 10 on hand/);

  // Staff can discard it once they have seen it — and only then.
  await discardQueuedChange(queue, rows[0].key);
  assert.equal((await queue.all()).length, 0);
});

test('an auth failure stops the flush instead of retrying pointlessly', async () => {
  const queue = createMemoryQueue();
  await queue.add(movement('prod-a', 1));
  const unauthorized = async () => {
    const error = new Error('Signed out');
    error.status = 401;
    throw error;
  };
  const summary = await flushQueue(queue, 'biz-1', { send: unauthorized });
  assert.equal(summary.stopped, true);
  assert.equal(summary.stillPending, 1);
  assert.equal((await queue.all()).length, 1);
});

test('another business’s queue is never flushed by mistake', async () => {
  const queue = createMemoryQueue();
  await queue.add(newQueuedChange('biz-1', 'movement', { product_id: 'p', location_id: 'l', type: 'sale', quantity: 1 }));
  await queue.add(newQueuedChange('biz-2', 'movement', { product_id: 'p', location_id: 'l', type: 'sale', quantity: 1 }));
  let sentBusiness = null;
  const send = async (path) => {
    sentBusiness = path;
    return { results: [{ status: 'applied' }] };
  };
  await flushQueue(queue, 'biz-1', { send });
  assert.match(sentBusiness, /biz-1/);
  const rows = await queue.all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].businessId, 'biz-2');
});

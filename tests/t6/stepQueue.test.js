/**
 * T6 — Optimistic stepper queue (owner live report, Nov 14, 2026:
 * the Products ▲▼ steppers "take a second to think" before the
 * number moves). The display must climb the instant a tap lands;
 * the ledger sends follow in tap order, one movement per tap; a
 * failure rolls the display back to the last confirmed quantity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStepQueue } from '../../src/lib/stepQueue.js';

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
};

test('rapid taps: the display climbs instantly, sends land in tap order', async () => {
  const sent = [];
  const displays = [];
  let drains = 0;
  const queue = createStepQueue({
    send: async (delta, confirmed) => {
      sent.push([delta, confirmed]);
    },
    onDisplay: (v) => displays.push(v),
    onError: () => assert.fail('no error expected'),
    onDrain: () => {
      drains += 1;
    },
  });
  // Five fast ▲ taps from 10 — the display must reach 15 BEFORE any
  // send resolves (the sends are async; nothing has been awaited).
  for (let i = 0; i < 5; i += 1) queue.tap(1, 10);
  assert.deepEqual(displays, [11, 12, 13, 14, 15], 'every tap repainted immediately');
  assert.equal(queue.display, 15);
  await flush();
  assert.deepEqual(
    sent,
    [
      [1, 10],
      [1, 11],
      [1, 12],
      [1, 13],
      [1, 14],
    ],
    'five sends, in tap order, each seeing the confirmed quantity before it',
  );
  assert.equal(queue.confirmed, 15, 'the server lands at +5');
  assert.equal(drains, 1, 'the queue drained exactly once');
});

test('down taps: a correction send is computed from the confirmed quantity at its turn', async () => {
  const sent = [];
  const queue = createStepQueue({
    send: async (delta, confirmed) => {
      sent.push([delta, confirmed]);
    },
    onDisplay: () => {},
    onError: () => assert.fail('no error expected'),
    onDrain: () => {},
  });
  queue.tap(1, 10); // receive → confirmed 11
  queue.tap(-1, 10); // correction to confirmed-1 = 10 at its turn
  queue.tap(-1, 10); // correction to 9 at its turn
  await flush();
  assert.deepEqual(sent, [
    [1, 10],
    [-1, 11],
    [-1, 10],
  ]);
  assert.equal(queue.confirmed, 9);
  assert.equal(queue.display, 9);
});

test('failure mid-queue: later sends are skipped, the display rolls back, one error', async () => {
  const sent = [];
  const displays = [];
  const errors = [];
  let drains = 0;
  const queue = createStepQueue({
    send: async (delta, confirmed) => {
      sent.push([delta, confirmed]);
      if (sent.length === 2) throw new Error('network gone');
    },
    onDisplay: (v) => displays.push(v),
    onError: (err) => errors.push(err),
    onDrain: () => {
      drains += 1;
    },
  });
  queue.tap(1, 10);
  queue.tap(1, 10);
  queue.tap(1, 10);
  queue.tap(1, 10);
  assert.equal(queue.display, 14, 'all four taps showed instantly');
  await flush();
  assert.equal(sent.length, 2, 'the third and fourth sends never ran — their math assumed the failed one');
  assert.equal(queue.confirmed, 11, 'only the first send landed');
  assert.equal(queue.display, 11, 'the display rolled back to the last confirmed quantity');
  assert.equal(displays.at(-1), 11, 'the rollback repainted');
  assert.equal(errors.length, 1, 'exactly one error surfaced');
  assert.equal(drains, 1, 'the dead queue still drained');
  // After the drain the queue accepts taps again from the truth.
  queue.tap(1, 11);
  await flush();
  assert.equal(queue.confirmed, 12, 'stepping resumes from the confirmed quantity');
});

test('a tap that would take the count below zero is refused and sends nothing', async () => {
  const sent = [];
  const queue = createStepQueue({
    send: async (delta, confirmed) => {
      sent.push([delta, confirmed]);
    },
    onDisplay: () => {},
    onError: () => assert.fail('no error expected'),
    onDrain: () => {},
  });
  assert.equal(queue.tap(-1, 0), false, 'the tap is refused at zero');
  queue.tap(1, 0);
  queue.tap(-1, 0);
  queue.tap(-1, 0); // display is 0 again — refused
  await flush();
  assert.deepEqual(sent, [
    [1, 0],
    [-1, 1],
  ]);
  assert.equal(queue.display, 0);
});

test('page wiring: Products steps through the queue and repaints from optimistic state', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../../src/pages/Products.jsx', import.meta.url), 'utf8');
  assert.ok(page.includes("import { createStepQueue } from '@/lib/stepQueue';"), 'the page uses the shared queue');
  assert.ok(page.includes('queue.tap(delta, start);'), 'taps go through the queue');
  assert.ok(page.includes('value={displayQty(product, stepperLocation, total)}'), 'the main steppers paint the optimistic value');
  assert.ok(page.includes('value={displayQty(product, place, q)}'), 'the per-location steppers paint the optimistic value');
  assert.ok(!page.includes('steppingKey'), 'the old single-flight lock is gone — taps are no longer dropped while a send is in flight');
  assert.ok(
    page.includes("title: t('products.stockStepFailed')"),
    'a failed send toasts with the existing stock-step string',
  );
});

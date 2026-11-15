/**
 * T6 — The Products-page stock door (Nov 14, 2026). The owner
 * missed the old app's up/down arrows beside the quantity: from
 * Products there was no way to add stock at all. Pins:
 *  - an inline stepper beside the on-hand number wherever ONE
 *    location is unambiguous (single location, or the list
 *    filtered to one), and on each per-location line of the
 *    expanded row;
 *  - each tap is a real ledger movement through recordMovement
 *    (up = receive +1; down = a correction setting the count one
 *    lower), never a bare number edit, never below zero;
 *  - where location is ambiguous, the number opens the shared
 *    AdjustStockDialog sheet with the location explicit, and the
 *    row menu carries the same door as "Add stock".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../src/pages/Products.jsx', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../../src/components/products/ProductRowMenu.jsx', import.meta.url), 'utf8');

test('the stepper exists and each direction records the honest movement type', () => {
  assert.ok(page.includes('function InlineStockStepper'), 'the inline stepper component exists');
  assert.ok(page.includes("type: 'receive', quantity: 1"), 'up is a receive of one');
  // Since the optimistic queue (Nov 14, 2026), the correction target
  // is computed at SEND time from the queue's confirmed quantity —
  // the same honest correction to one lower, ordered behind the
  // taps before it (behavior-pinned in stepQueue.test.js).
  assert.ok(page.includes("type: 'correction',"), 'down is a correction');
  assert.ok(page.includes('quantity: confirmed - 1,'), 'set to one lower than the confirmed count');
  assert.ok(page.includes('recordMovement({ product, location,'), 'taps go through the shared movement funnel');
});

test('the down tap can never take a count below zero', () => {
  const queue = readFileSync(new URL('../../src/lib/stepQueue.js', import.meta.url), 'utf8');
  assert.ok(queue.includes('if (display + delta < 0) return false;'), 'the queue refuses a tap that would go below zero');
  assert.ok(page.includes('disabled={value <= 0}'), 'the down arrow disables at zero');
});

test('the stepper only acts where one location is unambiguous; elsewhere the number opens the sheet', () => {
  assert.ok(page.includes('candidates.length === 1 ? candidates[0] : null'), 'a single candidate location enables the stepper');
  assert.ok(page.includes('filterLocationIds'), 'the filtered-to-one-location case counts as unambiguous');
  assert.ok(page.includes('onClick={() => setAdjusting(product)}'), 'the ambiguous number opens the stock sheet');
  assert.ok(page.includes('<AdjustStockDialog'), 'the shared stock sheet is mounted');
  assert.ok(page.includes('onDone={() => setReload((r) => r + 1)}'), 'the row refreshes after the sheet saves');
});

test('the expanded per-location lines carry their own steppers, and the row menu has Add stock', () => {
  assert.ok(page.includes('onStep={(delta) => stepStock(product, place, delta)}'), 'each location line steps its own count');
  assert.ok(menu.includes("t('products.addStock')"), 'the row menu offers Add stock');
  assert.ok(menu.includes('onAddStock'), 'the menu door is wired by the page');
});

test('the row shows the cover photo beside the name at every size', () => {
  assert.ok(
    page.includes('product.photo_urls?.[0] ? ('),
    'the beside-the-name thumbnail renders only when a cover photo exists — no photo, no placeholder box',
  );
  assert.ok(
    page.includes('className="h-11 w-11 xl:hidden"'),
    'the in-name thumbnail covers the sizes where the grid-cell thumb is hidden (the phone case the owner hit)',
  );
  assert.ok(
    page.includes('<ProductThumb product={product} className="hidden h-10 w-10 xl:block" />'),
    'the xl grid-cell thumbnail is unchanged',
  );
});

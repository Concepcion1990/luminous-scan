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
  assert.ok(page.includes("type: 'correction', quantity: current - 1"), 'down is a correction to one lower');
  assert.ok(page.includes('await recordMovement({'), 'taps go through the shared movement funnel');
});

test('the down tap can never take a count below zero', () => {
  assert.ok(page.includes('if (delta < 0 && current <= 0) return;'), 'the handler refuses at zero');
  assert.ok(page.includes('disabled={busy || value <= 0}'), 'the down arrow disables at zero');
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

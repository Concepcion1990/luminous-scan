/**
 * T6 — Adjust-door pins (owner catch, Nov 19, 2026). The server
 * behavior is pinned over HTTP in tests/t3/adjustDoor.test.js;
 * these source pins hold the wiring: the dedicated route exists
 * with the products.edit gate, the Adjust sheet and the Products
 * stepper write through it (not the scanner's scan.use funnel),
 * and the list UIs only offer the door to products.edit holders.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('../../server/shopRoutes.js', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('../../src/components/inventory/AdjustStockDialog.jsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('../../src/components/inventory/InventoryRow.jsx', import.meta.url), 'utf8');
const inventoryPage = readFileSync(new URL('../../src/pages/Inventory.jsx', import.meta.url), 'utf8');
const productsPage = readFileSync(new URL('../../src/pages/Products.jsx', import.meta.url), 'utf8');
const inventoryLib = readFileSync(new URL('../../src/lib/inventory.js', import.meta.url), 'utf8');

test('the server carries a dedicated stock-adjustments door gated on products.edit', () => {
  assert.ok(routes.includes("'/businesses/:bid/stock-adjustments'"), 'the adjust route exists');
  assert.ok(
    routes.includes("writeMovement('products.edit', ['receive', 'sale', 'count', 'correction'])"),
    'the adjust door asks for products.edit and only the adjustment types',
  );
  assert.ok(
    routes.includes("router.post('/businesses/:bid/movements', writeMovement('scan.use', null))"),
    'the generic movement door stays the scanner door (scan.use, all types)',
  );
});

test('the Adjust sheet saves through the adjustment door, never the scanner funnel', () => {
  assert.ok(dialog.includes('recordAdjustment'), 'the sheet calls recordAdjustment');
  assert.ok(!dialog.includes('recordMovement'), 'the sheet no longer rides recordMovement');
  assert.ok(inventoryLib.includes('/stock-adjustments'), 'the client door posts to the adjust route');
});

test('the list UIs offer the stock doors only to products.edit holders', () => {
  assert.ok(row.includes('canAdjust'), 'the inventory row takes a canAdjust gate');
  assert.ok(row.includes('{canAdjust && ('), 'the Adjust button renders only when the gate passes');
  assert.ok(inventoryPage.includes("can('products.edit')"), 'the inventory page computes the gate');
  assert.ok(inventoryPage.includes('canAdjust={canEditProducts}'), 'the inventory page passes the gate to rows');
  assert.ok(productsPage.includes("can('products.edit')"), 'the products page computes the gate');
  assert.ok(
    productsPage.includes('archived || !canEditProducts'),
    'products counts render as plain numbers without the permission (stepper, sheet door, per-location steppers)',
  );
  assert.ok(
    productsPage.includes('onAddStock={archived || !canEditProducts ? undefined'),
    'the row menu Add stock door is withheld without the permission',
  );
});

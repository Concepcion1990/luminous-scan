/**
 * Data freshness (Nov 14, 2026) — regression tests for the stale
 * page bug: a product created from the Scan screen left the
 * kept-alive Products page and Overview showing pre-create counts
 * until a pull-to-refresh remounted them. The bus semantics are
 * tested for real here; the wiring (entity client bumps, screens
 * subscribe through useDataFresh) is pinned by source, matching
 * the repo's component-test style.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bumpData, dataVersion, subscribeData } from './dataFreshness.js';

test('bumpData advances the scope version and notifies subscribers; unsubscribe stops notifications', () => {
  const scope = `test-${Math.random()}`;
  assert.equal(dataVersion(scope), 0);
  let calls = 0;
  const off = subscribeData(scope, () => {
    calls += 1;
  });
  bumpData(scope);
  bumpData(scope);
  assert.equal(dataVersion(scope), 2);
  assert.equal(calls, 2);
  off();
  bumpData(scope);
  assert.equal(dataVersion(scope), 3);
  assert.equal(calls, 2, 'an unsubscribed listener is not called again');
});

test('scopes are independent', () => {
  const a = `a-${Math.random()}`;
  const b = `b-${Math.random()}`;
  bumpData(a);
  assert.equal(dataVersion(a), 1);
  assert.equal(dataVersion(b), 0);
});

test('the entity client bumps inventory freshness on product/stock writes only', () => {
  const client = readFileSync(new URL('../api/client.js', import.meta.url), 'utf8');
  assert.ok(client.includes("INVENTORY_ENTITIES = new Set(['Product', 'StockLevel', 'StockMovement', 'Category', 'Location', 'ImportEvent'])"));
  assert.ok(client.includes("bumpData('inventory')"), 'writes announce through the bus');
  assert.ok(client.includes('create: (values) => announce('), 'create is announced');
  assert.ok(client.includes('updateMany: (filter, patch) =>'), 'bulk paths exist');
  const sync = readFileSync(new URL('./syncClient.js', import.meta.url), 'utf8');
  assert.ok(sync.includes("bumpData('inventory')"), 'a successful offline-queue flush announces too');
});

test('the three inventory screens refetch through useDataFresh', () => {
  const products = readFileSync(new URL('../pages/Products.jsx', import.meta.url), 'utf8');
  assert.ok(products.includes("useDataFresh('inventory', '/products', () => setReload((r) => r + 1))"));
  const dashboard = readFileSync(new URL('../pages/Dashboard.jsx', import.meta.url), 'utf8');
  assert.ok(dashboard.includes("useDataFresh('inventory', '/', () => setReload((r) => r + 1))"));
  assert.ok(dashboard.includes('[activeId, showPurchasing, reload]'), 'the Overview load effect takes the reload dep');
  const inventory = readFileSync(new URL('../pages/Inventory.jsx', import.meta.url), 'utf8');
  assert.ok(inventory.includes("useDataFresh('inventory', '/inventory', load)"));
  const hook = readFileSync(new URL('../hooks/useDataFresh.js', import.meta.url), 'utf8');
  assert.ok(hook.includes('v !== seen.current'), 'activation refetches only when the version moved');
  assert.ok(hook.includes('subscribeData(scope'), 'visible screens refetch on a bump');
});
